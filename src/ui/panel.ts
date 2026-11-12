import { GUI, type Controller } from 'three/addons/libs/lil-gui.module.min.js';
import type { EngineId, PortTier } from '../core/experiment';
import type { ParamSchema, ParamState, ParamValue } from '../core/params';
import { findExperiment } from '../core/registry';
import type { ExperimentRunner } from '../core/runner';
import { BACKDROPS } from '../core/backdrops';
import { STAGE_SCHEMA, type Stage } from '../core/stage';

const ENGINE_LABELS: Record<EngineId, string> = { ue: 'UE5', unity: 'Unity', godot: 'Godot', dx12: 'DX12' };
const ENGINE_ORDER: EngineId[] = ['ue', 'unity', 'godot', 'dx12'];
const TIER_HINT: Record<PortTier, string> = {
  native: 'built-in material, parameters only',
  graph: 'one node-graph material',
  code: 'shader code inside the material',
  extra: 'more than one material: meshes, particles, post, scripts',
};

export interface CaptureSettings {
  duration: number;
  fps: number;
  width: number;
}

export interface PanelActions {
  onParamsChanged(): void;
  savePng(): void;
  /** Records a GIF from the current time; `progress` receives 0..1. */
  recordGif(settings: CaptureSettings, progress: (t: number) => void): Promise<void>;
}

// lil-gui typings bind each controller to its property's type; the schema is dynamic, so use a loose view.
interface LooseGui {
  add(object: object, property: string, ...args: unknown[]): Controller;
  addColor(object: object, property: string): Controller;
}

/** Adds one controller per schema entry. Values are read from and written through `state`. */
function addControllers(
  folder: GUI,
  schema: ParamSchema,
  state: ParamState<ParamSchema>,
  onChange: (key: string, value: ParamValue) => void,
): Controller[] {
  const proxy = { ...state.values } as Record<string, ParamValue>;
  const gui = folder as unknown as LooseGui;
  return Object.entries(schema).map(([key, spec]) => {
    const name = spec.label ?? key;
    let c: Controller;
    switch (spec.type) {
      case 'number':
        c = gui.add(proxy, key, spec.min, spec.max, spec.step ?? (spec.max - spec.min) / 100);
        if (spec.unit) c.name(`${name} (${spec.unit})`);
        else c.name(name);
        break;
      case 'color':
        c = gui.addColor(proxy, key).name(name);
        break;
      case 'boolean':
        c = gui.add(proxy, key).name(name);
        break;
      case 'select':
        c = gui.add(proxy, key, [...spec.options]).name(name);
        break;
    }
    if (spec.hint) c.domElement.title = spec.hint;
    c.onChange((value: unknown) => onChange(key, value as ParamValue));
    return c;
  });
}

export class Panel {
  private readonly gui = new GUI({ title: 'Prototype', width: 320 });
  private paramsFolder: GUI | null = null;
  private paramControllers: Controller[] = [];
  private readonly stageControllers: Controller[];
  private readonly toolsFolder: GUI;
  private readonly quick = { backdrop: 'none' };
  private readonly backdropController: Controller;
  private readonly info = document.getElementById('info')!;

  constructor(private readonly runner: ExperimentRunner, private readonly stage: Stage, private readonly actions: PanelActions) {
    // Quick backdrop switch at the top; the full set lives in the Stage folder.
    this.backdropController = (this.gui as unknown as LooseGui)
      .add(this.quick, 'backdrop', [...BACKDROPS])
      .name('Backdrop')
      .onChange((value: unknown) => {
        stage.state.set('backdrop', value as string);
        stage.apply();
        this.syncStage();
      });

    const tools = (this.toolsFolder = this.gui.addFolder('Tools'));
    tools.add({ reset: () => this.resetParams() }, 'reset').name('Reset params');
    tools.add({ copy: () => void this.copyParams() }, 'copy').name('Copy params JSON');
    tools.add({ png: () => actions.savePng() }, 'png').name('Save PNG');
    tools.close();

    const capture = this.gui.addFolder('Capture GIF');
    const settings: CaptureSettings = { duration: 2, fps: 15, width: 480 };
    capture.add(settings, 'duration', 0.2, 20, 0.1).name('Duration (s)');
    capture.add(settings, 'fps', 5, 30, 1).name('FPS');
    capture.add(settings, 'width', 160, 1280, 16).name('Width (px)');
    const recordButton = capture.add({ record: () => {} }, 'record').name('Record GIF from current time');
    recordButton.onChange(async () => {
      recordButton.disable();
      try {
        await actions.recordGif(settings, (t) => recordButton.name(`Recording… ${Math.round(t * 100)}%`));
      } finally {
        recordButton.name('Record GIF from current time').enable();
      }
    });
    capture.close();

    const stageFolder = this.gui.addFolder('Stage');
    this.stageControllers = addControllers(stageFolder, STAGE_SCHEMA as unknown as ParamSchema, stage.state as unknown as ParamState<ParamSchema>, (key, value) => {
      stage.state.set(key, value);
      stage.apply();
      if (key === 'backdrop') this.syncStage();
    });
    stageFolder.close();

    runner.onChange(() => this.refresh());
    runner.onParamChange(() => this.syncParamControllers());
  }

  setVisible(visible: boolean): void {
    this.gui.show(visible);
    this.info.hidden = !visible;
  }

  /** Rebuilds the params folder and info card for the current experiment. */
  refresh(): void {
    const cur = this.runner.current;
    if (!cur) return;
    this.gui.title(cur.entry.def.title);

    this.paramsFolder?.destroy();
    this.paramsFolder = this.gui.addFolder('Params');
    // Keep Params at the top of the panel.
    this.toolsFolder.domElement.before(this.paramsFolder.domElement);
    this.paramControllers = addControllers(this.paramsFolder, cur.entry.def.params, cur.state, (key, value) => {
      this.runner.setParam(key, value);
      this.actions.onParamsChanged();
    });

    this.syncStage();
    this.renderInfo();
  }

  private syncParamControllers(): void {
    const values = this.runner.current?.state.values as Record<string, ParamValue> | undefined;
    if (!values) return;
    for (const c of this.paramControllers) {
      const proxy = c.object as Record<string, ParamValue>;
      if (proxy[c.property] === values[c.property]) continue;
      proxy[c.property] = values[c.property];
      c.updateDisplay();
    }
  }

  /** Pulls stage values (per-experiment overrides, quick backdrop switch) into the GUI controllers. */
  syncStage(): void {
    const stageValues = this.stage.state.values as Record<string, ParamValue>;
    for (const c of this.stageControllers) {
      (c.object as Record<string, ParamValue>)[c.property] = stageValues[c.property];
      c.updateDisplay();
    }
    this.quick.backdrop = this.stage.state.values.backdrop;
    this.backdropController.updateDisplay();
  }

  private renderInfo(): void {
    const cur = this.runner.current;
    if (!cur) return;
    const { def } = cur.entry;
    const card = document.createElement('div');
    const title = document.createElement('h1');
    title.textContent = def.title;
    const desc = document.createElement('p');
    desc.textContent = def.description;
    const badges = document.createElement('div');
    badges.className = 'badges';
    for (const engine of ENGINE_ORDER) {
      const note = def.port[engine];
      if (!note) continue;
      const b = document.createElement('span');
      b.className = `badge tier-${note.tier}`;
      b.textContent = `${ENGINE_LABELS[engine]}: ${note.tier.toUpperCase()}`;
      b.title = [`${ENGINE_LABELS[engine]} - ${TIER_HINT[note.tier]}`, ...(note.notes ?? []).map((n) => `• ${n}`)].join('\n');
      badges.append(b);
    }
    card.append(title, desc, badges);
    this.info.replaceChildren(card);
  }

  private resetParams(): void {
    const cur = this.runner.current;
    if (!cur) return;
    const entry = findExperiment(cur.entry.id);
    if (entry) void this.runner.load(entry, {}, {}, false).then(() => this.actions.onParamsChanged());
  }

  private async copyParams(): Promise<void> {
    const cur = this.runner.current;
    if (!cur) return;
    // `world` tells the engine side how to read positions and units (see docs/engine-port.md).
    const preset = {
      schemaVersion: 1,
      experiment: cur.entry.id,
      world: { units: 'meters', up: '+Y', handedness: 'right', forward: '-Z' },
      params: cur.state.values,
      stage: this.stage.state.values,
    };
    const text = JSON.stringify(preset, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      console.info(text);
    }
  }
}
