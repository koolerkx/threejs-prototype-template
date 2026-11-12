import type { AnyParamValues } from './params';

// Browser-local persistence (IndexedDB): parameter presets with thumbnails, and scene thumbnails.
// Per browser profile only; use Export / Import (JSON) or a committed presets.json to share.

export interface CameraView {
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
}

export interface Preset {
  id: string;
  experiment: string;
  name: string;
  params: AnyParamValues;
  stage: AnyParamValues;
  camera?: CameraView;
  time?: number;
  /** JPEG data URL. */
  thumbnail?: string;
  created: number;
  /** Loaded from a presets.json in the experiment folder; read-only in the page. */
  repo?: boolean;
}

export interface PresetFile {
  schemaVersion: 1;
  experiment: string;
  presets: Omit<Preset, 'id' | 'experiment' | 'repo'>[];
}

const DB_NAME = 'threejs-prototype';
const DB_VERSION = 1;
const PRESETS = 'presets';
const THUMBS = 'thumbs';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(PRESETS)) d.createObjectStore(PRESETS, { keyPath: 'id' }).createIndex('experiment', 'experiment');
      if (!d.objectStoreNames.contains(THUMBS)) d.createObjectStore(THUMBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

// Repo presets: src/experiments/**/presets.json (PresetFile format), shipped with the code.
const repoFiles = import.meta.glob<PresetFile>('../experiments/**/presets.json', { eager: true, import: 'default' });

function repoPresets(experiment: string): Preset[] {
  const file = Object.values(repoFiles).find((f) => f.experiment === experiment);
  return (file?.presets ?? []).map((p, i) => ({ ...p, id: `repo:${experiment}:${i}`, experiment, repo: true }));
}

export async function listPresets(experiment: string): Promise<Preset[]> {
  let local: Preset[] = [];
  try {
    local = await request<Preset[]>(PRESETS, 'readonly', (s) => s.index('experiment').getAll(experiment));
  } catch (err) {
    console.warn('[store] IndexedDB unavailable; presets are not saved', err);
  }
  return [...repoPresets(experiment), ...local.sort((a, b) => a.created - b.created)];
}

export function savePreset(preset: Preset): Promise<unknown> {
  return request(PRESETS, 'readwrite', (s) => s.put(preset));
}

export function deletePreset(id: string): Promise<unknown> {
  return request(PRESETS, 'readwrite', (s) => s.delete(id));
}

export function newPresetId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadThumbnail(experiment: string): Promise<string | undefined> {
  try {
    return await request<string | undefined>(THUMBS, 'readonly', (s) => s.get(experiment));
  } catch {
    return undefined;
  }
}

export function saveThumbnail(experiment: string, dataUrl: string): Promise<unknown> {
  return request(THUMBS, 'readwrite', (s) => s.put(dataUrl, experiment)).catch(() => undefined);
}

/** Serialises an experiment's presets in the presets.json format (commit it next to index.ts to share). */
export function toPresetFile(experiment: string, presets: Preset[]): PresetFile {
  return {
    schemaVersion: 1,
    experiment,
    presets: presets.map(({ id: _id, experiment: _e, repo: _r, ...rest }) => rest),
  };
}

/** Imports a presets file into IndexedDB; returns the number imported. */
export async function importPresetFile(file: PresetFile): Promise<number> {
  if (file?.schemaVersion !== 1 || typeof file.experiment !== 'string' || !Array.isArray(file.presets)) {
    throw new Error('Not a presets file (expected { schemaVersion: 1, experiment, presets: [...] }).');
  }
  for (const p of file.presets) {
    await savePreset({ ...p, id: newPresetId(), experiment: file.experiment, created: p.created ?? Date.now() });
  }
  return file.presets.length;
}
