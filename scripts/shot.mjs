#!/usr/bin/env node
// Agent vision: renders experiments in a real browser and writes PNGs plus a JSON report.
//
//   yarn shot                                   current default experiment
//   yarn shot --exp materials/stylized-rim      one experiment (id = folder path under src/experiments)
//   yarn shot --all                             every experiment (smoke check)
//   yarn shot --exp materials/stylized-rim --params '{"rimIntensity":4}' --stage '{"bloom":false}'
//   yarn shot --exp materials/stylized-rim --variants '[{"rimPower":1},{"rimPower":3},{"rimPower":6}]'
//   yarn shot --exp reference/pbr-calibration --variants '[{"$stage":{"backdrop":"sky"}},{"$stage":{"backdrop":"space"}}]'
//
// Options: --t <s> (frozen time, default 1)  --size 1280x720  --out .shots  --url <running dev server>
//          --headed  --channel chrome|msedge (use an installed browser instead of Playwright's Chromium)
//          --frames <n> (frames to wait after load, default 6)  --webgl (force the WebGL2 backend)
//          --page (capture the composited page incl. the experiment's HTML overlay; uses WebGL2 unless --headed)
//
// Output: .shots/<exp with / as .>[__v<n>].png, .shots/sheet.png (when more than one capture), .shots/report.json.
// Exit code 1 when any page error, console error or blank capture occurred.
// A blank WebGPU capture (GPU-less headless browser) is retried once on the WebGL2 backend.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const { values: args } = parseArgs({
  options: {
    exp: { type: 'string' },
    all: { type: 'boolean', default: false },
    params: { type: 'string', default: '{}' },
    stage: { type: 'string', default: '{}' },
    variants: { type: 'string' },
    t: { type: 'string', default: '1' },
    size: { type: 'string', default: '1280x720' },
    out: { type: 'string', default: '.shots' },
    url: { type: 'string' },
    headed: { type: 'boolean', default: false },
    channel: { type: 'string' },
    frames: { type: 'string', default: '6' },
    webgl: { type: 'boolean', default: false },
    page: { type: 'boolean', default: false },
  },
});

const parseJson = (name, text) => {
  try {
    return JSON.parse(text);
  } catch {
    console.error(`--${name} is not valid JSON: ${text}`);
    process.exit(2);
  }
};

const [width, height] = args.size.split('x').map(Number);
const baseParams = parseJson('params', args.params);
const stageOverrides = parseJson('stage', args.stage);
const variants = args.variants ? parseJson('variants', args.variants) : [null];
const outDir = resolve(args.out);
await mkdir(outDir, { recursive: true });

let server;
let baseUrl = args.url;
if (!baseUrl) {
  // Dedicated server without HMR so edits from another session do not reload the page mid-capture.
  server = await createServer({ server: { port: 5199, strictPort: false, hmr: false, watch: null }, logLevel: 'silent' }); // page errors are collected from the browser instead
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
}

let browser;
try {
  browser = await chromium.launch({
    headless: !args.headed,
    channel: args.channel,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu'],
  });
} catch (err) {
  console.error(`Browser launch failed. Run \`yarn setup\` once, or pass --channel chrome.\n${err.message}`);
  await server?.close();
  process.exit(2);
}

const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
// Driver chatter, and Chrome's message when a WebGPU device is torn down by navigation.
const NOISE = [/GL Driver Message/, /GPU stall due to ReadPixels/, /Instance dropped in popErrorScope/];
page.on('console', (msg) => {
  if (msg.type() !== 'error' && msg.type() !== 'warning') return;
  if (NOISE.some((re) => re.test(msg.text()))) return;
  logs.push({ type: msg.type(), text: msg.text() });
});
page.on('pageerror', (err) => logs.push({ type: 'pageerror', text: err.message }));

const query = (exp, extra = {}) => {
  const q = new URLSearchParams({ shot: '1', t: args.t, ...extra });
  if (args.webgl) q.set('webgl', '1');
  if (exp) q.set('exp', exp);
  return `${baseUrl}?${q}`;
};

// Resolve the experiment list from the page itself.
await page.goto(query(args.exp));
await page.waitForFunction(() => window.__proto?.ready || document.body.dataset.error, null, { timeout: 30_000 });
const startupError = await page.evaluate(() => document.body.dataset.error);
if (startupError) {
  console.error(`Startup failed: ${startupError}`);
  for (const l of logs) console.error(`  [${l.type}] ${l.text}`);
  await browser.close();
  await server?.close();
  process.exit(1);
}
const all = await page.evaluate(() => window.__proto.list().map((e) => e.id));
const ids = args.all ? all : [args.exp ?? (await page.evaluate(() => window.__proto.current()?.id))];

const shots = [];
for (const id of ids) {
  if (!all.includes(id)) {
    console.error(`Unknown experiment "${id}". Known: ${all.join(', ')}`);
    continue;
  }
  for (const [i, variant] of variants.entries()) {
    const { $stage: variantStage = {}, ...variantParams } = variant ?? {};
    const params = { ...baseParams, ...variantParams };
    const stage = { ...stageOverrides, ...variantStage };
    let logStart = logs.length;
    const started = Date.now();
    const load = async (webgl) => {
      await page.goto(query(id, { params: JSON.stringify(params), stage: JSON.stringify(stage), ...(webgl ? { webgl: '1' } : {}) }));
      await page.waitForFunction(() => window.__proto?.ready || document.body.dataset.error, null, { timeout: 30_000 });
      await page.evaluate((n) => window.__proto?.frames(n), Number(args.frames));
      // Read the canvas inside the page: compositor screenshots can miss WebGPU canvases in headless mode.
      return page.evaluate(() => window.__proto?.capture());
    };
    if (args.page) {
      await load(args.webgl || !args.headed); // headless compositing misses WebGPU canvases
      const png = await page.screenshot();
      const file = resolve(outDir, `${id.replaceAll('/', '.')}${variant ? `__v${i}` : ''}.png`);
      await writeFile(file, png);
      const info = await page.evaluate(() => ({ stats: window.__proto?.stats(), current: window.__proto?.current() }));
      const entryLogs = logs.slice(logStart);
      shots.push({ id, variant: variant ?? undefined, file, ms: Date.now() - started, stats: info.stats, params: info.current?.params,
        blank: false, errors: entryLogs.filter((l) => l.type !== 'warning').map((l) => l.text),
        warnings: entryLogs.filter((l) => l.type === 'warning').map((l) => l.text), png });
      continue;
    }
    let capture = await load(args.webgl);
    let fallback = false;
    if (capture?.blank && !args.webgl) {
      fallback = true; // no readable WebGPU image (GPU-less headless browser): retry on the WebGL2 backend
      logStart = logs.length; // report only the attempt that produced the image
      capture = await load(true);
    }
    const file = resolve(outDir, `${id.replaceAll('/', '.')}${variant ? `__v${i}` : ''}.png`);
    const png = capture
      ? Buffer.from(capture.dataUrl.slice(capture.dataUrl.indexOf(',') + 1), 'base64')
      : await page.locator('#viewport canvas').screenshot();
    await writeFile(file, png);
    const info = await page.evaluate(() => ({ stats: window.__proto?.stats(), current: window.__proto?.current() }));
    const entryLogs = logs.slice(logStart);
    shots.push({
      id,
      variant: variant ?? undefined,
      file,
      ms: Date.now() - started,
      stats: info.stats,
      params: info.current?.params,
      blank: capture?.blank ?? false,
      webgpuFallback: fallback || undefined,
      errors: entryLogs.filter((l) => l.type !== 'warning').map((l) => l.text),
      warnings: entryLogs.filter((l) => l.type === 'warning').map((l) => l.text),
      png,
    });
  }
}

// Contact sheet: one image the agent can read to compare captures side by side.
if (shots.length > 1) {
  const cols = Math.min(shots.length, 3);
  const cellW = Math.round(width / 2);
  const cellH = Math.round(height / 2);
  const cells = shots
    .map((s) => {
      const label = s.variant ? `${s.id} ${JSON.stringify(s.variant)}` : s.id;
      return `<figure><img src="data:image/png;base64,${s.png.toString('base64')}"><figcaption>${label.replace(/</g, '&lt;')}</figcaption></figure>`;
    })
    .join('');
  await page.setViewportSize({ width: cols * cellW, height: Math.ceil(shots.length / cols) * (cellH + 22) });
  await page.setContent(`<style>
    body{margin:0;display:grid;grid-template-columns:repeat(${cols},${cellW}px);background:#111;font:12px monospace;color:#ddd}
    figure{margin:0}img{width:${cellW}px;height:${cellH}px;display:block}figcaption{height:22px;line-height:22px;padding:0 6px;overflow:hidden;white-space:nowrap}
  </style>${cells}`);
  await page.screenshot({ path: resolve(outDir, 'sheet.png'), fullPage: true });
}

await browser.close();
await server?.close();

const report = shots.map(({ png, ...rest }) => rest);
await writeFile(resolve(outDir, 'report.json'), JSON.stringify({ url: baseUrl, t: Number(args.t), shots: report }, null, 2));

let failed = false;
for (const s of report) {
  const status = s.errors.length ? 'ERROR' : s.blank ? 'BLANK' : 'ok';
  if (s.errors.length || s.blank) failed = true;
  const st = s.stats ?? {};
  console.log(`${status.padEnd(5)} ${s.id}${s.variant ? ` ${JSON.stringify(s.variant)}` : ''}  ${st.backend} ${st.drawCalls} draws ${st.triangles} tris  ${s.ms} ms  -> ${s.file}`);
  for (const e of s.errors) console.log(`      error: ${e.split('\n')[0]}`);
  for (const w of s.warnings.slice(0, 3)) console.log(`      warn:  ${w.split('\n')[0]}`);
}
if (shots.length > 1) console.log(`sheet -> ${resolve(outDir, 'sheet.png')}`);
if (report.some((s) => s.webgpuFallback)) {
  console.log('note: WebGPU gave no readable image in this browser, so captures used the WebGL2 backend. Try --headed or --channel chrome for WebGPU.');
}
process.exit(failed ? 1 : 0);
