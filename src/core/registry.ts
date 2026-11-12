import type { ExperimentDef } from './experiment';

// Every folder under src/experiments/ with an index.ts that default-exports defineExperiment(...) is an experiment.
// Folders starting with `_` (the scaffold template) are skipped. The folder name is the experiment id.
const modules = import.meta.glob<{ default: ExperimentDef }>('../experiments/*/index.ts', { eager: true });

export type RegisteredExperiment = { id: string; def: ExperimentDef };

export const EXPERIMENTS: RegisteredExperiment[] = Object.entries(modules)
  .map(([path, mod]) => ({ id: path.split('/').at(-2)!, def: mod.default }))
  .filter(({ id, def }) => !id.startsWith('_') && def)
  .sort((a, b) => a.id.localeCompare(b.id));

export function findExperiment(id: string | null | undefined): RegisteredExperiment | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}
