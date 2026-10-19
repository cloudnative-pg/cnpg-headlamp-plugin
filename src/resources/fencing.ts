/**
 * Declarative fencing annotation (see CNPG's pkg/utils/fencing.go and the `kubectl cnpg fencing`
 * command in internal/cmd/plugin/fence/fence.go): a JSON list of fenced instance names, or `["*"]`
 * to fence every instance. The annotation is removed entirely once no instance is fenced.
 */
export const FENCED_INSTANCES_ANNOTATION = 'cnpg.io/fencedInstances';

/** Token CNPG uses in the fencing annotation to mean "every instance of the cluster". */
export const FENCE_ALL_INSTANCES = '*';

/**
 * Parses the fencing annotation value. Returns an empty list when the annotation is absent and
 * `undefined` when it is present but not a JSON list of strings — the operator rejects such a
 * value too (ErrorFencedInstancesSyntax), so callers must not overwrite it blindly.
 */
export function parseFencedInstances(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Returns the fenced-instance list after fencing or unfencing `instanceName`, mirroring the
 * operator's AddFencedInstance/removeFencedInstance: the list is deduplicated and sorted, and
 * fencing an instance while `*` is set is a no-op. Unfencing a single instance while `*` is set
 * throws, since the operator refuses it too (ErrorSingleInstanceUnfencing).
 */
export function updateFencedInstances(
  current: string[],
  instanceName: string,
  fenced: boolean
): string[] {
  const set = new Set(current);
  if (fenced) {
    if (set.has(FENCE_ALL_INSTANCES)) {
      return [...current];
    }
    if (instanceName === FENCE_ALL_INSTANCES) {
      return [FENCE_ALL_INSTANCES];
    }
    set.add(instanceName);
  } else {
    if (instanceName === FENCE_ALL_INSTANCES) {
      return [];
    }
    if (set.has(FENCE_ALL_INSTANCES)) {
      throw new Error('all instances are fenced: unfence all of them instead of a single one');
    }
    set.delete(instanceName);
  }
  return [...set].sort();
}
