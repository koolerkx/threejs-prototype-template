import type { EngineId } from '../core/experiment';
import { EXPERIMENTS, type RegisteredExperiment } from '../core/registry';

// Center-open gallery of all scenes, grouped by folder, from the stored thumbnails.
// Performance: the DOM is built once on first open; thumbnails are plain <img> with lazy loading and async decoding;
// sections use content-visibility so off-screen cards cost nothing; the viewport stops rendering while it is open.

export interface GalleryHost {
  open(id: string): void;
  current(): string | null;
  thumbnail(id: string): string | undefined;
  /** Viewport rendering on/off while the modal covers it. */
  setRenderingPaused(paused: boolean): void;
  /** Captures thumbnails for scenes that have none (loads each scene once). */
  generateMissing(onProgress: (done: number, total: number) => void): Promise<void>;
}

const TIER_ENGINES: EngineId[] = ['ue', 'unity'];

export class Gallery {
  private root: HTMLElement | null = null;
  private filter!: HTMLInputElement;
  private status!: HTMLElement;
  private readonly cards = new Map<string, { el: HTMLElement; img: HTMLImageElement; hay: string }>();
  private sections: { el: HTMLElement; ids: string[] }[] = [];
  private openState = false;

  constructor(private readonly host: GalleryHost) {
    addEventListener('keydown', (e) => {
      if (!this.openState) return;
      if (e.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (!this.root) this.build();
    this.refreshThumbs();
    this.markActive();
    this.root!.hidden = false;
    this.openState = true;
    this.host.setRenderingPaused(true);
    requestAnimationFrame(() => this.filter.focus());
  }

  close(): void {
    if (!this.root || !this.openState) return;
    this.root.hidden = true;
    this.openState = false;
    this.host.setRenderingPaused(false);
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  /** Updates one card's thumbnail (called when a new thumbnail is captured). */
  updateThumbnail(id: string): void {
    const card = this.cards.get(id);
    const url = this.host.thumbnail(id);
    if (card && url && card.img.src !== url) {
      card.img.src = url;
      card.el.classList.remove('no-thumb');
    }
  }

  private build(): void {
    const root = document.createElement('div');
    root.id = 'gallery';
    root.hidden = true;
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'gallery-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Scene gallery');

    const head = document.createElement('div');
    head.className = 'gallery-head';
    const title = document.createElement('h2');
    title.textContent = `Scenes · ${EXPERIMENTS.length}`;
    this.filter = document.createElement('input');
    this.filter.type = 'search';
    this.filter.placeholder = 'Filter by name, folder or tag';
    this.filter.addEventListener('input', () => this.applyFilter());
    this.status = document.createElement('span');
    this.status.className = 'gallery-status';
    const gen = document.createElement('button');
    gen.textContent = 'Generate missing thumbnails';
    gen.addEventListener('click', async () => {
      gen.disabled = true;
      try {
        await this.host.generateMissing((d, t) => (this.status.textContent = `Capturing ${d} / ${t}…`));
        this.status.textContent = '';
        this.refreshThumbs();
      } finally {
        gen.disabled = false;
      }
    });
    const close = document.createElement('button');
    close.className = 'gallery-close';
    close.textContent = '×';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => this.close());
    head.append(title, this.filter, this.status, gen, close);

    const body = document.createElement('div');
    body.className = 'gallery-body';
    const groups = new Map<string, RegisteredExperiment[]>();
    for (const e of EXPERIMENTS) {
      const folder = e.id.includes('/') ? e.id.slice(0, e.id.lastIndexOf('/')) : '(root)';
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder)!.push(e);
    }
    for (const [folder, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const section = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = folder;
      const grid = document.createElement('div');
      grid.className = 'gallery-grid';
      grid.append(...entries.map((e) => this.card(e)));
      section.append(h, grid);
      body.append(section);
      this.sections.push({ el: section, ids: entries.map((e) => e.id) });
    }

    dialog.append(head, body);
    root.append(dialog);
    document.body.append(root);
    this.root = root;
  }

  private card(entry: RegisteredExperiment): HTMLElement {
    const el = document.createElement('button');
    el.className = 'gallery-card no-thumb';
    el.title = entry.def.description;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.def.title;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = entry.id.split('/').at(-1)!;
    const dots = document.createElement('span');
    dots.className = 'dots';
    for (const engine of TIER_ENGINES) {
      const tier = entry.def.port[engine]?.tier;
      if (!tier) continue;
      const d = document.createElement('span');
      d.className = `dot tier-${tier}`;
      d.title = `${engine.toUpperCase()}: ${tier}`;
      dots.append(d);
    }
    el.append(img, name, meta, dots);
    el.addEventListener('click', () => {
      this.host.open(entry.id);
      this.close();
    });
    this.cards.set(entry.id, { el, img, hay: `${entry.id} ${entry.def.title} ${(entry.def.tags ?? []).join(' ')}`.toLowerCase() });
    return el;
  }

  private refreshThumbs(): void {
    for (const id of this.cards.keys()) this.updateThumbnail(id);
  }

  private markActive(): void {
    const current = this.host.current();
    for (const [id, c] of this.cards) c.el.classList.toggle('active', id === current);
  }

  private applyFilter(): void {
    const words = this.filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const s of this.sections) {
      let visible = 0;
      for (const id of s.ids) {
        const c = this.cards.get(id)!;
        const show = words.every((w) => c.hay.includes(w));
        c.el.hidden = !show;
        if (show) visible++;
      }
      s.el.hidden = visible === 0;
    }
  }
}
