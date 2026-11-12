import type { AnyParamValues } from './params';

// URL contract (also used by scripts/shot.mjs):
//   ?exp=<id>            experiment to load
//   &params=<json>       parameter overrides, e.g. {"rimIntensity":2}
//   &stage=<json>        stage overrides, e.g. {"bloom":true}
//   &t=<seconds>         freeze experiment time (deterministic capture)
//   &shot=1              capture mode: hide UI, no URL sync
//   &webgl=1             force the WebGL2 backend (compare against WebGPU, or work around a driver issue)
//   &cam=<1-9>           start from camera bookmark n
//   &camera=<json>       start from {"position":[x,y,z],"target":[x,y,z],"fovDeg":45}
export interface UrlState {
  exp: string | null;
  params: AnyParamValues;
  stage: AnyParamValues;
  frozenTime: number | null;
  shot: boolean;
  forceWebGL: boolean;
  cam: number | null;
  camera: AnyParamValues;
}

function parseJson(raw: string | null): AnyParamValues {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyParamValues) : {};
  } catch {
    console.warn(`[url] ignored invalid JSON: ${raw}`);
    return {};
  }
}

export function readUrlState(): UrlState {
  const q = new URLSearchParams(location.search);
  const t = q.get('t');
  const frozen = t === null ? null : Number(t);
  return {
    exp: q.get('exp'),
    params: parseJson(q.get('params')),
    stage: parseJson(q.get('stage')),
    frozenTime: frozen !== null && Number.isFinite(frozen) ? frozen : null,
    shot: q.get('shot') === '1',
    forceWebGL: q.get('webgl') === '1',
    cam: /^[1-9]$/.test(q.get('cam') ?? '') ? Number(q.get('cam')) : null,
    camera: parseJson(q.get('camera')),
  };
}

/** Writes the current experiment and its non-default params to the address bar (shareable link). */
export function writeUrlState(exp: string, changedParams: AnyParamValues): void {
  const q = new URLSearchParams(location.search);
  q.set('exp', exp);
  if (Object.keys(changedParams).length > 0) q.set('params', JSON.stringify(changedParams));
  else q.delete('params');
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
}
