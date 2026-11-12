import type { EngineId } from '../core/experiment';
import { EXPERIMENTS, type RegisteredExperiment } from '../core/registry';
import { loadThumbnail } from '../core/store';

// File-browser style scene switcher: the folder tree under src/experiments/, filterable, keyboard navigable.
//   Click / Enter: open   ArrowUp / ArrowDown: move and open   ArrowLeft / ArrowRight: collapse / expand folder
//   '/' focuses the filter, Escape clears it.

type FolderNode = { kind: 'folder'; name: string; path: string; children: TreeNode[] };
type SceneNode = { kind: 'scene'; name: string; entry: RegisteredExperiment };
type TreeNode = FolderNode | SceneNode;

const COLLAPSED_KEY = 'proto.sceneBrowser.collapsed';
const BADGE_ENGINES: EngineId[] = ['ue', 'unity'];

function buildTree(entries: RegisteredExperiment[]): FolderNode {
  const root: FolderNode = { kind: 'folder', name: '', path: '', children: [] };
  for (const entry of entries) {
    const parts = entry.id.split('/');
    let folder = root;
    parts.slice(0, -1).forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = folder.children.find((c): c is FolderNode => c.kind === 'folder' && c.name === name);
      if (!next) {
        next = { kind: 'folder', name, path, children: [] };
        folder.children.push(next);
      }
      folder = next;
    });
    folder.children.push({ kind: 'scene', name: parts.at(-1)!, entry });
  }
  const sort = (f: FolderNode) => {
    f.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
    f.children.forEach((c) => c.kind === 'folder' && sort(c));
  };
  sort(root);
  return root;
}

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // Storage unavailable (private mode, sandbox): folder state is per session only.
  }
}

function matches(entry: RegisteredExperiment, query: string): boolean {
  if (!query) return true;
  const hay = `${entry.id} ${entry.def.title} ${(entry.def.tags ?? []).join(' ')}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
}

export class SceneBrowser {
  private readonly root = document.getElementById('browser')!;
  private readonly list: HTMLElement;
  private readonly filter: HTMLInputElement;
  private readonly tree = buildTree(EXPERIMENTS);
  private readonly collapsed = loadCollapsed();
  private activeId: string | null = null;
  private visibleScenes: string[] = [];
  private readonly thumbs = new Map<string, string>();

  constructor(private readonly onOpen: (id: string) => void, onGallery?: () => void) {
    const head = document.createElement('div');
    head.className = 'browser-head';
    const title = document.createElement('span');
    title.textContent = `Scenes · ${EXPERIMENTS.length}`;
    this.filter = document.createElement('input');
    this.filter.type = 'search';
    this.filter.placeholder = 'Filter  ( / )';
    this.filter.addEventListener('input', () => this.render());
    this.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.filter.value = '';
        this.render();
        this.filter.blur();
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        this.filter.blur();
        this.step(e.key === 'Enter' ? 0 : 1);
      }
    });
    const titleRow = document.createElement('div');
    titleRow.className = 'browser-title';
    titleRow.append(title);
    if (onGallery) {
      const gallery = document.createElement('button');
      gallery.textContent = '⊞ Gallery';
      gallery.title = 'Open all scenes as a gallery (G)';
      gallery.addEventListener('click', () => {
        gallery.blur();
        onGallery();
      });
      titleRow.append(gallery);
    }
    head.append(titleRow, this.filter);

    this.list = document.createElement('div');
    this.list.className = 'browser-list';
    this.list.setAttribute('role', 'tree');
    this.root.replaceChildren(head, this.list);

    addEventListener('keydown', (e) => this.onKey(e));
    this.render();
    void Promise.all(EXPERIMENTS.map(async ({ id }) => {
      const url = await loadThumbnail(id);
      if (url) this.thumbs.set(id, url);
    })).then(() => this.render());
  }

  getThumbnail(id: string): string | undefined {
    return this.thumbs.get(id);
  }

  /** Last-seen thumbnail of a scene (captured automatically after it loads). */
  setThumbnail(id: string, dataUrl: string): void {
    this.thumbs.set(id, dataUrl);
    this.render();
  }

  setActive(id: string): void {
    this.activeId = id;
    // Reveal the active scene if its folder is collapsed.
    const parts = id.split('/');
    parts.slice(0, -1).forEach((_, i) => this.collapsed.delete(parts.slice(0, i + 1).join('/')));
    this.render();
    this.list.querySelector('.scene.active')?.scrollIntoView({ block: 'nearest' });
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    document.body.classList.toggle('browser-hidden', !visible);
  }

  private render(): void {
    const query = this.filter.value.trim();
    this.visibleScenes = [];
    const rows: HTMLElement[] = [];
    const walk = (folder: FolderNode, depth: number) => {
      for (const node of folder.children) {
        if (node.kind === 'folder') {
          const count = this.countMatches(node, query);
          if (query && count === 0) continue;
          const open = query.length > 0 || !this.collapsed.has(node.path);
          rows.push(this.folderRow(node, depth, open, count));
          if (open) walk(node, depth + 1);
        } else if (matches(node.entry, query)) {
          rows.push(this.sceneRow(node, depth));
          this.visibleScenes.push(node.entry.id);
        }
      }
    };
    walk(this.tree, 0);
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'browser-empty';
      empty.textContent = 'No scene matches.';
      rows.push(empty);
    }
    this.list.replaceChildren(...rows);
  }

  private countMatches(folder: FolderNode, query: string): number {
    return folder.children.reduce(
      (n, c) => n + (c.kind === 'folder' ? this.countMatches(c, query) : matches(c.entry, query) ? 1 : 0),
      0,
    );
  }

  private folderRow(node: FolderNode, depth: number, open: boolean, count: number): HTMLElement {
    const row = document.createElement('button');
    row.className = 'row folder';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-expanded', String(open));
    row.innerHTML = `<span class="chevron">${open ? '▾' : '▸'}</span><span class="icon">▤</span><span class="name"></span><span class="count">${count}</span>`;
    row.querySelector('.name')!.textContent = node.name;
    row.addEventListener('click', () => {
      if (this.collapsed.has(node.path)) this.collapsed.delete(node.path);
      else this.collapsed.add(node.path);
      saveCollapsed(this.collapsed);
      this.render();
    });
    row.addEventListener('mouseup', () => row.blur());
    return row;
  }

  private sceneRow(node: SceneNode, depth: number): HTMLElement {
    const { entry } = node;
    const row = document.createElement('button');
    row.className = `row scene${entry.id === this.activeId ? ' active' : ''}`;
    row.style.paddingLeft = `${8 + depth * 14 + 14}px`;
    row.setAttribute('role', 'treeitem');
    row.title = `${entry.id}\n${entry.def.description}`;

    const icon = document.createElement('span');
    const thumb = this.thumbs.get(entry.id);
    if (thumb) {
      icon.className = 'sthumb';
      icon.style.backgroundImage = `url(${thumb})`;
    } else {
      icon.className = 'icon';
      icon.textContent = '◆';
    }
    const text = document.createElement('span');
    text.className = 'text';
    const title = document.createElement('span');
    title.className = 'name';
    title.textContent = entry.def.title;
    const file = document.createElement('span');
    file.className = 'file';
    file.textContent = node.name;
    text.append(title, file);
    const dots = document.createElement('span');
    dots.className = 'dots';
    for (const engine of BADGE_ENGINES) {
      const tier = entry.def.port[engine]?.tier;
      if (!tier) continue;
      const d = document.createElement('span');
      d.className = `dot tier-${tier}`;
      d.title = `${engine.toUpperCase()}: ${tier}`;
      dots.append(d);
    }
    row.append(icon, text, dots);
    row.addEventListener('click', () => {
      row.blur(); // keep Space for the time transport
      this.onOpen(entry.id);
    });
    return row;
  }

  /** Moves the selection by `delta` visible scenes (0 = open the first match) and opens it. */
  private step(delta: number): void {
    if (this.visibleScenes.length === 0) return;
    const index = this.activeId ? this.visibleScenes.indexOf(this.activeId) : -1;
    const next = delta === 0 || index < 0 ? 0 : Math.min(Math.max(index + delta, 0), this.visibleScenes.length - 1);
    const id = this.visibleScenes[next];
    if (id && id !== this.activeId) this.onOpen(id);
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target.closest('.lil-gui') || this.root.hidden) return;
    if (e.key === '/') {
      e.preventDefault();
      this.filter.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.step(e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.activeId) {
      const folder = this.activeId.split('/').slice(0, -1).join('/');
      if (!folder) return;
      if (e.key === 'ArrowLeft') this.collapsed.add(folder);
      else this.collapsed.delete(folder);
      saveCollapsed(this.collapsed);
      this.render();
    }
  }
}
