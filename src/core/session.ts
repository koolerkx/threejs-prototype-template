import type { ClockState } from './clock';
import type { AnyParamValues } from './params';
import type { CameraView } from './store';

// Keeps the working state across reloads in this tab (Vite full reloads after an experiment edit, F5):
// camera, time transport and stage settings. Params already live in the URL.

const KEY = 'proto.session';

export interface SessionState {
  experiment: string;
  camera: CameraView;
  clock: ClockState;
  stage: AnyParamValues;
}

export function saveSession(state: SessionState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable
  }
}

/** Returns the saved state for `experiment`, if the last session was on the same one. */
export function loadSession(experiment: string): SessionState | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as SessionState | null;
    return s && s.experiment === experiment ? s : null;
  } catch {
    return null;
  }
}
