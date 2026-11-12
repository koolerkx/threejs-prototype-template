import { Color, type UniformNode } from 'three/webgpu';
import { uniform } from 'three/tsl';

// Declarative parameters. Each parameter maps 1:1 to an engine material parameter
// (UE Scalar/Vector Parameter, Unity Shader Graph property, Godot uniform), so keep
// names engine-friendly (camelCase here, PascalCase in the engine).

type ParamBase = {
  label?: string;
  /** Re-run the experiment's setup() when this value changes (geometry, topology, material type). */
  rebuild?: boolean;
  /** Short hint shown as a tooltip and copied into port notes. */
  hint?: string;
};

export type NumberParam = ParamBase & {
  type: 'number';
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Physical or engine unit, e.g. 'm', 'deg', 's', 'lux'. */
  unit?: string;
};
export type ColorParam = ParamBase & { type: 'color'; value: string };
export type BooleanParam = ParamBase & { type: 'boolean'; value: boolean };
export type SelectParam = ParamBase & { type: 'select'; value: string; options: readonly string[] };

export type ParamSpec = NumberParam | ColorParam | BooleanParam | SelectParam;
export type ParamSchema = Record<string, ParamSpec>;

type ValueOf<P extends ParamSpec> = P extends NumberParam
  ? number
  : P extends ColorParam
    ? string
    : P extends BooleanParam
      ? boolean
      : P extends SelectParam
        ? P['options'][number]
        : never;

export type ParamValues<S extends ParamSchema> = { -readonly [K in keyof S]: ValueOf<S[K]> };

type UniformOf<P extends ParamSpec> = P extends ColorParam ? UniformNode<'color'> : UniformNode<'float'>;

/** TSL uniforms for every non-select parameter. Booleans are 0/1 floats. */
export type ParamUniforms<S extends ParamSchema> = {
  readonly [K in keyof S as S[K] extends SelectParam ? never : K]: UniformOf<S[K]>;
};

export type ParamValue = number | string | boolean;
export type AnyParamValues = Record<string, ParamValue>;

export interface ParamState<S extends ParamSchema> {
  readonly values: ParamValues<S>;
  readonly uniforms: ParamUniforms<S>;
  /** Writes a value and syncs its uniform. Returns false when the key or type is invalid. */
  set(key: string, value: ParamValue): boolean;
  reset(): void;
}

export function defaultValues(schema: ParamSchema): AnyParamValues {
  return Object.fromEntries(Object.entries(schema).map(([key, spec]) => [key, spec.value]));
}

/** Coerces an external value (URL, JSON, GUI) to the spec's type; undefined when it does not fit. */
export function coerce(spec: ParamSpec, value: unknown): ParamValue | undefined {
  switch (spec.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'color':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined;
    case 'select':
      return typeof value === 'string' && spec.options.includes(value) ? value : undefined;
  }
}

export function createParamState<S extends ParamSchema>(schema: S, overrides: AnyParamValues = {}): ParamState<S> {
  const values: AnyParamValues = defaultValues(schema);
  const uniforms: Record<string, UniformNode<'float'> | UniformNode<'color'>> = {};

  for (const [key, spec] of Object.entries(schema)) {
    if (spec.type === 'color') uniforms[key] = uniform(new Color(spec.value));
    else if (spec.type === 'number') uniforms[key] = uniform(spec.value);
    else if (spec.type === 'boolean') uniforms[key] = uniform(spec.value ? 1 : 0);
  }

  const set = (key: string, raw: ParamValue): boolean => {
    const spec = schema[key];
    if (!spec) return false;
    const value = coerce(spec, raw);
    if (value === undefined) return false;
    values[key] = value;
    const u = uniforms[key];
    if (!u) return true;
    if (spec.type === 'color') (u.value as Color).set(value as string);
    else u.value = spec.type === 'boolean' ? Number(value) : (value as number);
    return true;
  };

  for (const [key, value] of Object.entries(overrides)) set(key, value);

  return {
    values: values as ParamValues<S>,
    uniforms: uniforms as unknown as ParamUniforms<S>,
    set,
    reset: () => {
      for (const [key, spec] of Object.entries(schema)) set(key, spec.value);
    },
  };
}
