import { CURATED_PARAMETER_NAMES, RESTART_PARAMETER_NAMES } from './parameters';

/**
 * Parameters with a dedicated field in the CNPG spec (`spec.postgresql.shared_preload_libraries`)
 * or otherwise managed by the operator. They are never offered as free-form rows nor patched, so
 * a stray entry in `spec.postgresql.parameters` can't show up as a perpetual pending change.
 */
export const OPERATOR_MANAGED_PARAMETER_NAMES: ReadonlySet<string> = new Set([
  'shared_preload_libraries',
]);

export interface ParameterChange {
  key: string;
  /** Current value, undefined when the key isn't set yet. */
  from?: string;
  /** New value, undefined when the key is being removed. */
  to?: string;
  restart: boolean;
}

export interface ExtraRow {
  id: number;
  key: string;
  value: string;
}

/**
 * Builds the map of parameters the user wants from the curated fields plus the free-form rows.
 * An empty value means "unset" (the operator re-adds its own default for keys that have one).
 * Keys and values are trimmed.
 */
export function collectEdited(
  curated: Record<string, string>,
  extras: ExtraRow[]
): Record<string, string> {
  const edited: Record<string, string> = {};
  for (const [key, value] of Object.entries(curated)) {
    if (value.trim() !== '') {
      edited[key] = value.trim();
    }
  }
  for (const row of extras) {
    const key = row.key.trim();
    if (key !== '' && row.value.trim() !== '') {
      edited[key] = row.value.trim();
    }
  }
  return edited;
}

/** Keys that were added, changed or removed, sorted by key. */
export function diffParameters(
  current: Record<string, string>,
  edited: Record<string, string>
): ParameterChange[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(edited)]);
  const changes: ParameterChange[] = [];
  for (const key of Array.from(keys).sort()) {
    if (OPERATOR_MANAGED_PARAMETER_NAMES.has(key)) {
      continue;
    }
    // collectEdited drops empty values, so an empty current value must count as unset too,
    // otherwise it would be reported as a removal every time the dialog opens.
    const from = current[key]?.trim() === '' ? undefined : current[key];
    const to = edited[key];
    if (from !== to) {
      changes.push({ key, from, to, restart: RESTART_PARAMETER_NAMES.has(key) });
    }
  }
  return changes;
}

/**
 * The `spec.postgresql.parameters` merge patch: new/changed keys carry their value, removed keys
 * `null`. Keys that didn't change are left out, so we never resend operator-managed ones.
 */
export function toMergePatch(changes: ParameterChange[]): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const change of changes) {
    patch[change.key] = change.to ?? null;
  }
  return patch;
}

/** Validation messages for the free-form rows, keyed by row id. */
export function validateExtras(extras: ExtraRow[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  for (const row of extras) {
    const key = row.key.trim();
    if (key === '') {
      if (row.value.trim() !== '') {
        errors[row.id] = 'Enter the parameter name.';
      }
      continue;
    }
    if (/\s|=/.test(key)) {
      errors[row.id] = 'A parameter name cannot contain spaces or "=".';
    } else if (CURATED_PARAMETER_NAMES.has(key)) {
      errors[row.id] = 'This parameter has its own field above.';
    } else if (seen.has(key)) {
      errors[row.id] = 'Duplicate parameter.';
    }
    seen.add(key);
  }
  return errors;
}
