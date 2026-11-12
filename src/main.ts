import { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ExperimentClock } from './core/clock';
import type { ParamValue } from './core/params';
import { PerfMonitor } from './core/perf';
import { EXPERIMENTS, findExperiment } from './core/registry';
import { ExperimentRunner } from './core/runner';
import { loadSession, saveSession } from './core/session';
import { Stage, VIEW_MODES, type ViewMode } from './core/stage';
import { saveThumbnail, type CameraView } from './core/store';
import { readUrlState, writeUrlState } from './core/urlState';
import { installDebugApi, type FrameSignal } from './harness/debugApi';
import { download, record, type FrameGrabber } from './harness/recorder';
import { Bookmarks } from './ui/bookmarks';
import { Panel } from './ui/panel';
import { PerfHud } from './ui/perfHud';
import { PresetsPanel } from './ui/presetsPanel';
import { SceneBrowser } from './ui/sceneBrowser';
import { Transport } from './ui/transport';
import './style.css';

const MAX_PIXEL_RATIO = 2;
const URL_SYNC_DELAY_MS = 300;
/** Opened when the URL names no experiment. */
const DEFAULT_EXPERIMENT = 'reference/pbr-calibration';
/** Frames to wait after a load before the scene thumbnail is taken (shaders compiled, IBL baked). */
const THUMB_DELAY_FRAMES = 45;
const THUMB_WIDTH = 160;
const PRESET_THUMB_WIDTH = 240;

async function main(): Promise<void> {
  const url = readUrlState();
  const viewport = document.getElementById('viewport')!;
  document.body.classList.toggle('shot', url.shot);

  // trackTimestamp: GPU pass timings for the perf HUD (ignored where the backend lacks timestamp queries).
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: url.forceWebGL, trackTimestamp: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
  viewport.append(renderer.domElement);

  const camera = new PerspectiveCamera(45, 1, 0.05, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !url.shot;

  const stage = new Stage(renderer, camera);
  const runner = new ExperimentRunner(renderer, camera, controls, stage);
  const clock = new ExperimentClock(url.frozenTime ?? 0, url.frozenTime !== null);
  const signal: FrameSignal = { frame: 0, waiters: [] };
  const perf = new PerfMonitor(renderer);
  const perfHud = new PerfHud(perf);

  // --- Camera views ---
  const getView = (): CameraView => ({
    position: camera.position.toArray() as CameraView['position'],
    target: controls.target.toArray() as CameraView['target'],
    fovDeg: camera.fov,
  });
  const setView = (v: Partial<CameraView>) => {
    if (v.position) camera.position.fromArray(v.position);
    if (v.target) controls.target.fromArray(v.target);
    if (v.fovDeg) camera.fov = v.fovDeg;
    camera.updateProjectionMatrix();
    controls.update();
  };
  const bookmarks = new Bookmarks({ getView, setView });

  // --- Frame grabs: copies of the canvas taken right after a render (same task, so WebGPU content is readable) ---
  const grabs: { width: number; resolve: (c: HTMLCanvasElement) => void }[] = [];
  const grabber: FrameGrabber = { grab: (width) => new Promise((resolve) => grabs.push({ width, resolve })) };
  const flushGrabs = () => {
    for (const g of grabs.splice(0)) {
      const src = renderer.domElement;
      const c = document.createElement('canvas');
      c.width = Math.round(g.width);
      c.height = Math.round((g.width * src.height) / Math.max(src.width, 1));
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      g.resolve(c);
    }
  };

  let panel: Panel | null = null;
  const api = installDebugApi({
    canvas: renderer.domElement, runner, stage, clock, perf, signal, grabber, getView, setView,
    budget: () => perfHud.budget,
    bookmark: (n) => bookmarks.jump(n),
    onStageChanged: () => panel?.syncStage(),
  });

  let urlTimer = 0;
  const syncUrl = () => {
    if (url.shot) return;
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      if (runner.current) writeUrlState(runner.current.entry.id, runner.changedParams());
    }, URL_SYNC_DELAY_MS);
  };

  const browser = new SceneBrowser((id) => {
    const entry = findExperiment(id);
    if (entry) void runner.load(entry).then(syncUrl);
  });

  const presets = new PresetsPanel(document.getElementById('browser')!, {
    experiment: () => runner.current?.entry.id ?? null,
    snapshot: () => ({
      params: { ...runner.current!.state.values },
      stage: { ...stage.state.values },
      camera: getView(),
      time: clock.state.time,
    }),
    thumbnail: async () => (await grabber.grab(PRESET_THUMB_WIDTH)).toDataURL('image/jpeg', 0.8),
    apply: (p) => {
      const entry = findExperiment(p.experiment);
      if (!entry) return;
      void runner.load(entry, p.params, p.stage).then(() => {
        if (p.camera) setView(p.camera);
        if (p.time !== undefined) clock.set({ time: p.time, paused: true });
        panel?.syncStage();
        syncUrl();
      });
    },
  });

  const fileName = () => runner.current?.entry.id.replaceAll('/', '.') ?? 'capture';
  panel = new Panel(runner, stage, {
    onParamsChanged: syncUrl,
    savePng: () => {
      stage.render(); // read back in the same task as the render; the canvas may be cleared afterwards
      const a = document.createElement('a');
      a.download = `${fileName()}.png`;
      a.href = renderer.domElement.toDataURL('image/png');
      a.click();
    },
    recordGif: async (settings, progress) => {
      const result = await record(clock, grabber, { ...settings, gif: true, onProgress: (d, t) => progress(d / t) });
      if (result.gif) download(result.gif, `${fileName()}.gif`);
    },
  });

  const transport = new Transport(clock);
  transport.append(bookmarks.element);

  const setUiVisible = (visible: boolean) => {
    panel?.setVisible(visible);
    browser.setVisible(visible);
    presets.setVisible(visible);
    transport.setVisible(visible);
    perfHud.setVisible(visible);
  };
  setUiVisible(!url.shot);

  // Per-load wiring: reset time, view state, budget, bookmarks, presets, and an automatic scene thumbnail.
  let thumbAt = -1;
  runner.onChange(() => {
    const cur = runner.current;
    if (!cur) return;
    clock.reset();
    stage.refreshView();
    perfHud.setOverride(cur.entry.def.budget);
    const fov = cur.entry.def.camera?.fovDeg ?? 45;
    bookmarks.setExperiment(
      cur.entry.id,
      (cur.entry.def.bookmarks ?? []).map((b) => ({ position: [...b.position], target: [...b.target], fovDeg: b.fovDeg ?? fov })),
    );
    browser.setActive(cur.entry.id);
    void presets.refresh();
    thumbAt = url.shot ? -1 : signal.frame + THUMB_DELAY_FRAMES;
  });
  const takeSceneThumb = async () => {
    const id = runner.current?.entry.id;
    if (!id || stage.state.values.view !== 'lit') return;
    const dataUrl = (await grabber.grab(THUMB_WIDTH)).toDataURL('image/jpeg', 0.75);
    if (runner.current?.entry.id !== id) return;
    browser.setThumbnail(id, dataUrl);
    void saveThumbnail(id, dataUrl);
  };

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
    if (e.code === 'KeyH') setUiVisible(!document.body.classList.toggle('ui-hidden'));
    if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = VIEW_MODES.indexOf(stage.state.values.view as ViewMode);
      const next = VIEW_MODES[(i + (e.shiftKey ? VIEW_MODES.length - 1 : 1)) % VIEW_MODES.length];
      stage.state.set('view', next);
      stage.apply();
      panel?.syncStage();
    }
  });

  // --- First load: URL > session (same experiment, kept across reloads) > experiment defaults ---
  const first = findExperiment(url.exp) ?? findExperiment(DEFAULT_EXPERIMENT) ?? EXPERIMENTS[0];
  if (!first) throw new Error('No experiments found under src/experiments/.');
  if (url.exp && first.id !== url.exp) console.warn(`[main] unknown experiment "${url.exp}", loaded "${first.id}"`);
  const session = url.shot ? null : loadSession(first.id);
  await runner.load(first, url.params, { ...session?.stage, ...url.stage });
  if (session) {
    setView(session.camera);
    if (url.frozenTime === null) clock.set(session.clock);
    panel.syncStage();
  }
  if (url.cam !== null) bookmarks.jump(url.cam);
  if (Object.keys(url.camera).length > 0) setView(url.camera as Partial<CameraView>);
  syncUrl();

  // Keep camera, time and stage across reloads in this tab (Vite full reload after an edit, F5).
  const persist = () => {
    const cur = runner.current;
    if (!cur || url.shot) return;
    saveSession({ experiment: cur.entry.id, camera: getView(), clock: clock.state, stage: { ...stage.state.values } as Record<string, ParamValue> });
  };
  addEventListener('pagehide', persist);
  import.meta.hot?.on('vite:beforeFullReload', persist);

  renderer.setAnimationLoop(() => {
    perf.beginFrame();
    const frame = clock.tick();
    controls.update();
    stage.setFocus(controls.target);
    runner.update(frame);
    stage.render();
    flushGrabs();
    perf.endFrame();
    transport.update();
    perfHud.update();

    signal.frame++;
    if (signal.frame === thumbAt) void takeSceneThumb();
    signal.waiters = signal.waiters.filter((w) => (signal.frame >= w.until ? (w.resolve(), false) : true));
  });

  api.ready = true;
}

main().catch((err) => {
  console.error('[main] startup failed', err);
  document.body.dataset.error = String(err);
});
