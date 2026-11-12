import {
  deletePreset, importPresetFile, listPresets, newPresetId, savePreset, toPresetFile, type CameraView, type Preset, type PresetFile,
} from '../core/store';
import type { AnyParamValues } from '../core/params';

// Presets of the current experiment with thumbnails, under the scene tree.
// Saved in IndexedDB (this browser). Export writes presets.json; commit it next to the experiment's index.ts to
// ship the presets with the repo (shown with a "repo" tag, read-only). Import merges a presets.json file.

export interface PresetHost {
  experiment(): string | null;
  snapshot(): { params: AnyParamValues; stage: AnyParamValues; camera: CameraView; time: number };
  thumbnail(): Promise<string>;
  apply(preset: Preset): void;
}

export class PresetsPanel {
  private readonly root = document.createElement('section');
  private readonly grid = document.createElement('div');
  private readonly title = document.createElement('span');
  private presets: Preset[] = [];

  constructor(parent: HTMLElement, private readonly host: PresetHost) {
    this.root.className = 'presets';
    const head = document.createElement('div');
    head.className = 'presets-head';
    const button = (label: string, title: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => {
        b.blur();
        onClick();
      });
      return b;
    };
    head.append(
      this.title,
      button('+ Save', 'Save current params, stage, camera and time as a preset', () => void this.save()),
      button('Export', 'Download presets.json (commit next to index.ts to share)', () => this.export()),
      button('Import', 'Merge a presets.json file', () => this.import()),
    );
    this.grid.className = 'presets-grid';
    this.root.append(head, this.grid);
    parent.append(this.root);
  }

  async refresh(): Promise<void> {
    const exp = this.host.experiment();
    if (!exp) return;
    this.presets = await listPresets(exp);
    this.title.textContent = `Presets · ${this.presets.length}`;
    const cards = this.presets.map((p) => this.card(p));
    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'presets-empty';
      empty.textContent = 'No presets yet. "+ Save" stores the current view.';
      cards.push(empty);
    }
    this.grid.replaceChildren(...cards);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  private card(p: Preset): HTMLElement {
    const el = document.createElement('button');
    el.className = 'preset';
    el.title = `${p.name}\n${JSON.stringify(p.params)}`;
    const img = document.createElement('div');
    img.className = 'thumb';
    if (p.thumbnail) img.style.backgroundImage = `url(${p.thumbnail})`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    el.append(img, name);
    if (p.repo) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'repo';
      el.append(tag);
    } else {
      const del = document.createElement('span');
      del.className = 'delete';
      del.textContent = '×';
      del.title = 'Delete preset';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete preset "${p.name}"?`)) void deletePreset(p.id).then(() => this.refresh());
      });
      el.append(del);
    }
    el.addEventListener('click', () => {
      el.blur();
      this.host.apply(p);
    });
    return el;
  }

  private async save(): Promise<void> {
    const exp = this.host.experiment();
    if (!exp) return;
    const name = prompt('Preset name', `Preset ${this.presets.filter((p) => !p.repo).length + 1}`);
    if (!name) return;
    const snap = this.host.snapshot();
    const thumbnail = await this.host.thumbnail();
    await savePreset({ id: newPresetId(), experiment: exp, name, ...snap, thumbnail, created: Date.now() });
    await this.refresh();
  }

  private export(): void {
    const exp = this.host.experiment();
    if (!exp) return;
    const file = toPresetFile(exp, this.presets);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    a.download = 'presets.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private import(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text()) as PresetFile;
        const count = await importPresetFile(data);
        if (data.experiment !== this.host.experiment()) alert(`Imported ${count} presets for "${data.experiment}".`);
        await this.refresh();
      } catch (err) {
        alert(`Import failed: ${(err as Error).message}`);
      }
    });
    input.click();
  }
}
