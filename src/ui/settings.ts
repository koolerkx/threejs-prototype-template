// Settings widget: a gear button (bottom right of the viewport) that opens a panel with a toggle for everything
// drawn over or in the viewport. UI choices persist in localStorage; scene toggles (grid, shadow catcher, ...) edit
// the current stage settings. H still hides all UI at once.

export interface UiToggle {
  key: string;
  label: string;
  group: 'Interface' | 'Viewport';
  /** Default for persisted UI toggles. Scene toggles read their state through `get`. */
  initial?: boolean;
  get?: () => boolean;
  set: (on: boolean) => void;
}

const STORAGE_KEY = 'proto.ui';

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export class SettingsPanel {
  private readonly button = document.createElement('button');
  private readonly panel = document.createElement('div');
  private readonly saved = load();
  private readonly inputs = new Map<string, HTMLInputElement>();

  constructor(private readonly toggles: UiToggle[]) {
    this.button.id = 'settings-button';
    this.button.textContent = '⚙';
    this.button.title = 'Settings: show / hide UI and viewport elements';
    this.button.addEventListener('click', () => {
      this.button.blur();
      this.panel.hidden = !this.panel.hidden;
      if (!this.panel.hidden) this.sync();
    });

    this.panel.id = 'settings-panel';
    this.panel.hidden = true;
    for (const group of ['Interface', 'Viewport'] as const) {
      const h = document.createElement('h4');
      h.textContent = group;
      this.panel.append(h);
      for (const t of toggles.filter((x) => x.group === group)) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => this.change(t, input.checked));
        label.append(input, document.createTextNode(t.label));
        this.panel.append(label);
        this.inputs.set(t.key, input);
      }
    }
    const row = document.createElement('div');
    row.className = 'settings-actions';
    const all = (on: boolean, text: string) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => toggles.filter((t) => t.group === 'Interface').forEach((t) => this.change(t, on)));
      return b;
    };
    row.append(all(true, 'Show all'), all(false, 'Hide all'));
    this.panel.append(row);

    document.body.append(this.button, this.panel);
    addEventListener('mousedown', (e) => {
      if (!this.panel.hidden && !this.panel.contains(e.target as Node) && e.target !== this.button) this.panel.hidden = true;
    });

    // Apply persisted UI toggles once.
    for (const t of toggles) if (!t.get) t.set(this.isOn(t));
  }

  /** Whether a persisted UI toggle is on (used when the whole UI is shown again after H). */
  isOn(t: UiToggle | string): boolean {
    const toggle = typeof t === 'string' ? this.toggles.find((x) => x.key === t) : t;
    if (!toggle) return true;
    if (toggle.get) return toggle.get();
    return this.saved[toggle.key] ?? toggle.initial ?? true;
  }

  setVisible(visible: boolean): void {
    this.button.hidden = !visible;
    if (!visible) this.panel.hidden = true;
  }

  private change(t: UiToggle, on: boolean): void {
    if (!t.get) {
      this.saved[t.key] = on;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
      } catch {
        // storage unavailable
      }
    }
    t.set(on);
    this.sync();
  }

  private sync(): void {
    for (const t of this.toggles) {
      const input = this.inputs.get(t.key);
      if (input) input.checked = this.isOn(t);
    }
  }
}
