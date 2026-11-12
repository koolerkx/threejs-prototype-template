import type { ExperimentDef } from './experiment';

// Every `index.ts` under src/experiments/ that default-exports defineExperiment(...) is an experiment.
// Its id is the folder path, e.g. `materials/stylized-rim`; folders group experiments in the scene browser.
// Any path segment starting with `_` (the scaffold template, drafts) is skipped.
const modules = import.meta.glob<{ default: ExperimentDef }>('../experiments/**/index.ts', { eager: true });

export type RegisteredExperiment = { id: string; def: ExperimentDef };

const PREFIX = '../experiments/';
const SUFFIX = '/index.ts';

export const EXPERIMENTS: RegisteredExperiment[] = Object.entries(modules)
  .map(([path, mod]) => ({ id: path.slice(PREFIX.length, -SUFFIX.length), def: mod.default }))
  .filter(({ id, def }) => def && !id.split('/').some((seg) => seg.startsWith('_')))
  .sort((a, b) => a.id.localeCompare(b.id));

export function findExperiment(id: string | null | undefined): RegisteredExperiment | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}
