import { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ExperimentClock } from './core/clock';
import { EXPERIMENTS, findExperiment } from './core/registry';
import { ExperimentRunner } from './core/runner';
import { Stage } from './core/stage';
import { readUrlState, writeUrlState } from './core/urlState';
import { installDebugApi, type FrameSignal } from './harness/debugApi';
import { Panel } from './ui/panel';
import './style.css';

const MAX_PIXEL_RATIO = 2;
const URL_SYNC_DELAY_MS = 300;

async function main(): Promise<void> {
  const url = readUrlState();
  const viewport = document.getElementById('viewport')!;
  document.body.classList.toggle('shot', url.shot);

  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: url.forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
  viewport.append(renderer.domElement);

  const camera = new PerspectiveCamera(45, 1, 0.05, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !url.shot;

  const stage = new Stage(renderer, camera);
  const runner = new ExperimentRunner(renderer, camera, controls, stage);
  const clock = new ExperimentClock(url.frozenTime);
  const signal: FrameSignal = { frame: 0, fps: 0, waiters: [] };
  const api = installDebugApi(renderer, runner, stage, signal);

  let urlTimer = 0;
  const syncUrl = () => {
    if (url.shot) return;
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      if (runner.current) writeUrlState(runner.current.entry.id, runner.changedParams());
    }, URL_SYNC_DELAY_MS);
  };

  const panel = new Panel(runner, stage, {
    onExperimentChange: (id) => {
      const entry = findExperiment(id);
      if (entry) void runner.load(entry).then(syncUrl);
    },
    onParamsChanged: syncUrl,
    savePng: () => {
      stage.render(); // read back in the same task as the render; the canvas may be cleared afterwards
      const a = document.createElement('a');
      a.download = `${runner.current?.entry.id ?? 'frame'}.png`;
      a.href = renderer.domElement.toDataURL('image/png');
      a.click();
    },
  });
  panel.setVisible(!url.shot);
  runner.onChange(() => clock.reset());

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = viewport;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(viewport);
  resize();

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') clock.paused = !clock.paused;
    if (e.code === 'KeyH') panel.setVisible(document.body.classList.toggle('ui-hidden') === false);
  });

  const first = findExperiment(url.exp) ?? EXPERIMENTS[0];
  if (!first) throw new Error('No experiments found under src/experiments/.');
  if (url.exp && first.id !== url.exp) console.warn(`[main] unknown experiment "${url.exp}", loaded "${first.id}"`);
  await runner.load(first, url.params, url.stage);
  syncUrl();

  let fpsAccum = 0;
  let fpsFrames = 0;
  let statsTimer = 0;
  renderer.setAnimationLoop(() => {
    const frame = clock.tick();
    controls.update();
    runner.update(frame);
    stage.render();

    signal.frame++;
    const now = performance.now();
    fpsAccum += now - (statsTimer || now);
    statsTimer = now;
    if (++fpsFrames >= 30) {
      signal.fps = (fpsFrames * 1000) / Math.max(fpsAccum, 1);
      fpsAccum = 0;
      fpsFrames = 0;
      const s = api.stats();
      panel.setStats(`${s.backend} · ${s.fps} fps · ${s.drawCalls} draws · ${s.triangles.toLocaleString()} tris${clock.paused ? ' · paused' : ''}${clock.frozen ? ' · t frozen' : ''}`);
    }
    signal.waiters = signal.waiters.filter((w) => (signal.frame >= w.until ? (w.resolve(), false) : true));
  });

  api.ready = true;
}

main().catch((err) => {
  console.error('[main] startup failed', err);
  document.body.dataset.error = String(err);
});
