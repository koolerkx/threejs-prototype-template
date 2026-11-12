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
//          --cam <1-9> (camera bookmark)  --camera '{"position":[x,y,z],"target":[x,y,z]}'
//
// Motion: --range <start>:<end> steps time deterministically and writes a filmstrip of --count frames
//         (default 6) into sheet.png; add --gif for .shots/<exp>.gif at --fps (default 12).
//   yarn shot --exp materials/stylized-rim --range 0:2 --count 8 --gif
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
    range: { type: 'string' },
    fps: { type: 'string', default: '12' },
    count: { type: 'string', default: '6' },
    gif: { type: 'boolean', default: false },
    cam: { type: 'string' },
    camera: { type: 'string' },
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

const logs = [];
// Driver chatter, and Chrome's message when a WebGPU device is torn down by navigation.
const WEBGPU_LIMIT_MS = 45_000;
const NOISE = [/GL Driver Message/, /GPU stall due to ReadPixels/, /Instance dropped in popErrorScope/];
async function openPage() {
  const p = await browser.newPage({ viewport: { width, height } });
  p.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (NOISE.some((re) => re.test(msg.text()))) return;
    logs.push({ type: msg.type(), text: msg.text() });
  });
  p.on('pageerror', (err) => logs.push({ type: 'pageerror', text: err.message }));
  return p;
}
let page = await openPage();
// Becomes false once WebGPU gave no image in this browser; later captures go straight to WebGL2.
let webgpuWorks = true;

const query = (exp, extra = {}) => {
  const q = new URLSearchParams({ shot: '1', t: args.t, ...extra });
  if (args.webgl) q.set('webgl', '1');
  if (args.cam) q.set('cam', args.cam);
  if (args.camera) q.set('camera', args.camera);
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
      await page.waitForFunction(() => window.__proto?.ready || document.body.dataset.error, null, { timeout: 60_000 });
      await page.evaluate((n) => window.__proto?.frames(n), Number(args.frames));
      // Read the canvas inside the page: compositor screenshots can miss WebGPU canvases in headless mode.
      return page.evaluate(() => window.__proto?.capture());
    };
    // Software WebGPU (GPU-less headless) can stall for minutes compiling large shaders: give it a time limit,
    // then treat the attempt as blank so the WebGL2 retry runs.
    const loadWithLimit = async (webgl) => {
      if (webgl || args.headed || args.channel) return load(webgl);
      const result = await Promise.race([
        load(false).catch(() => ({ blank: true })),
        new Promise((resolve) => setTimeout(() => resolve({ blank: true, timedOut: true }), WEBGPU_LIMIT_MS)),
      ]);
      if (result?.timedOut) {
        // The stalled tab cannot navigate any more: replace it.
        await page.close().catch(() => {});
        page = await openPage();
      }
      return result;
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
    let capture = await loadWithLimit(args.webgl || !webgpuWorks);
    let fallback = !args.webgl && !webgpuWorks;
    if (capture?.blank && !args.webgl && webgpuWorks) {
      webgpuWorks = false;
      fallback = true; // no readable WebGPU image (GPU-less headless browser): retry on the WebGL2 backend
      logStart = logs.length; // report only the attempt that produced the image
      capture = await load(true);
    }
    const file = resolve(outDir, `${id.replaceAll('/', '.')}${variant ? `__v${i}` : ''}.png`);
    const png = capture
      ? Buffer.from(capture.dataUrl.slice(capture.dataUrl.indexOf(',') + 1), 'base64')
      : await page.locator('#viewport canvas').screenshot();
    await writeFile(file, png);
    let frames;
    if (args.range) {
      const [a, b] = args.range.split(':').map(Number);
      const fps = Number(args.fps);
      const rec = await page.evaluate(
        (o) => window.__proto.record(o),
        { start: a, duration: Math.max(b - a, 1 / fps), fps, width: Math.round(width / 2), gif: args.gif, keyFrames: Number(args.count) },
      );
      frames = rec.keyFrames.map((f) => ({ time: f.time, png: Buffer.from(f.dataUrl.slice(f.dataUrl.indexOf(',') + 1), 'base64') }));
      if (rec.gifBase64) await writeFile(file.replace(/\.png$/, '.gif'), Buffer.from(rec.gifBase64, 'base64'));
    }
    const info = await page.evaluate(() => ({ stats: window.__proto?.stats(), current: window.__proto?.current() }));
    const entryLogs = logs.slice(logStart);
    shots.push({
      frames,
      gif: args.range && args.gif ? file.replace(/\.png$/, '.gif') : undefined,
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

// Contact sheet: one image the agent can read to compare captures (or motion frames) side by side.
const cells = shots.flatMap((s) => {
  const label = s.variant ? `${s.id} ${JSON.stringify(s.variant)}` : s.id;
  return s.frames ? s.frames.map((f) => ({ label: `${label} t=${f.time.toFixed(2)}s`, png: f.png })) : [{ label, png: s.png }];
});
if (cells.length > 1) {
  const cols = Math.min(cells.length, args.range ? 4 : 3);
  const cellW = Math.round(width / 2);
  const cellH = Math.round(height / 2);
  const html = cells
    .map((c) => `<figure><img src="data:image/png;base64,${c.png.toString('base64')}"><figcaption>${c.label.replace(/</g, '&lt;')}</figcaption></figure>`)
    .join('');
  await page.setViewportSize({ width: cols * cellW, height: Math.ceil(cells.length / cols) * (cellH + 22) });
  await page.setContent(`<style>
    body{margin:0;display:grid;grid-template-columns:repeat(${cols},${cellW}px);background:#111;font:12px monospace;color:#ddd}
    figure{margin:0}img{width:${cellW}px;height:${cellH}px;display:block}figcaption{height:22px;line-height:22px;padding:0 6px;overflow:hidden;white-space:nowrap}
  </style>${html}`);
  await page.screenshot({ path: resolve(outDir, 'sheet.png'), fullPage: true });
}

await browser.close();
await server?.close();

const report = shots.map(({ png, frames, ...rest }) => ({ ...rest, frameTimes: frames?.map((f) => f.time) }));
await writeFile(resolve(outDir, 'report.json'), JSON.stringify({ url: baseUrl, t: Number(args.t), shots: report }, null, 2));

let failed = false;
for (const s of report) {
  const status = s.errors.length ? 'ERROR' : s.blank ? 'BLANK' : 'ok';
  if (s.errors.length || s.blank) failed = true;
  const st = s.stats ?? {};
  const gpu = typeof st.gpuMs === 'number' ? `gpu ${st.gpuMs.toFixed(2)} ms ` : '';
  console.log(`${status.padEnd(5)} ${s.id}${s.variant ? ` ${JSON.stringify(s.variant)}` : ''}  ${st.backend} ${st.drawCalls} draws ${st.triangles} tris ${gpu}cpu ${st.cpuMs?.toFixed(2)} ms  ${s.ms} ms  -> ${s.file}${s.gif ? ` + ${s.gif}` : ''}`);
  // Headless frame timings are software rendering; only report timing budgets for --headed runs.
  const over = (st.overBudget ?? []).filter((k) => args.headed || (k !== 'frame' && k !== 'gpu'));
  if (over.length) console.log(`      over budget: ${over.join(', ')}`);
  for (const e of s.errors) console.log(`      error: ${e.split('\n')[0]}`);
  for (const w of s.warnings.slice(0, 3)) console.log(`      warn:  ${w.split('\n')[0]}`);
}
if (cells.length > 1) console.log(`sheet -> ${resolve(outDir, 'sheet.png')}`);
if (report.some((s) => s.webgpuFallback)) {
  console.log('note: WebGPU gave no readable image in this browser, so captures used the WebGL2 backend. Try --headed or --channel chrome for WebGPU.');
}
process.exit(failed ? 1 : 0);
