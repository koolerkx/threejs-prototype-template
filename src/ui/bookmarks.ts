import type { CameraView } from '../core/store';

// UE-style camera bookmarks, per experiment, slots 1-9.
//   Ctrl+1..9 (or Alt+1..9, since Chrome keeps Ctrl+1..9 for tab switching) saves the current view.
//   1..9 jumps to a saved view. Click a slot to jump; Ctrl/Alt/Shift+click saves; right-click clears.
// Defaults can come from the experiment (`bookmarks`); saved slots live in localStorage.

const SLOTS = 9;
const KEY = (exp: string) => `proto.bookmarks.${exp}`;

export interface BookmarkHost {
  getView(): CameraView;
  setView(view: CameraView): void;
}

type Slots = Partial<Record<number, CameraView>>;

export class Bookmarks {
  readonly element = document.createElement('div');
  private experiment = '';
  private defaults: Slots = {};
  private saved: Slots = {};
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(private readonly host: BookmarkHost) {
    this.element.className = 'bookmarks';
    this.element.title = 'Camera bookmarks: 1-9 jump, Ctrl/Alt+1-9 or Ctrl+click save, right-click clear';
    for (let n = 1; n <= SLOTS; n++) {
      const b = document.createElement('button');
      b.textContent = String(n);
      b.addEventListener('click', (e) => {
        b.blur();
        if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) this.save(n);
        else this.jump(n);
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.clear(n);
      });
      this.buttons.push(b);
    }
    this.element.append(...this.buttons);
    addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Switches to an experiment's slots; `defaults` come from its definition. */
  setExperiment(id: string, defaults: CameraView[] = []): void {
    this.experiment = id;
    this.defaults = Object.fromEntries(defaults.slice(0, SLOTS).map((v, i) => [i + 1, v]));
    try {
      this.saved = JSON.parse(localStorage.getItem(KEY(id)) ?? '{}') as Slots;
    } catch {
      this.saved = {};
    }
    this.render();
  }

  get(n: number): CameraView | undefined {
    return this.saved[n] ?? this.defaults[n];
  }

  jump(n: number): boolean {
    const view = this.get(n);
    if (view) this.host.setView(view);
    return Boolean(view);
  }

  save(n: number): void {
    this.saved[n] = this.host.getView();
    this.persist();
  }

  private clear(n: number): void {
    delete this.saved[n];
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY(this.experiment), JSON.stringify(this.saved));
    } catch {
      // storage unavailable: slots last for this page only
    }
    this.render();
  }

  private render(): void {
    this.buttons.forEach((b, i) => {
      const n = i + 1;
      b.classList.toggle('set', Boolean(this.saved[n]));
      b.classList.toggle('default', !this.saved[n] && Boolean(this.defaults[n]));
    });
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t.closest('.lil-gui')) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    const n = Number(m[1]);
    if (e.ctrlKey || e.altKey || e.metaKey) {
      e.preventDefault();
      this.save(n);
    } else if (!e.shiftKey) {
      this.jump(n);
    }
  }
}
