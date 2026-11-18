/** Anything with a namespace; cluster-scoped kinds return undefined/empty and are never hidden. */
export interface Namespaced {
  getNamespace(): string | undefined;
}

export interface NamespaceScope<T> {
  /** The items inside the selected namespaces (all of them when no namespace is selected). */
  items: T[];
  /** How many items exist before the namespace filter is applied. */
  total: number;
  /** The selected namespaces, sorted; empty when the filter is off. */
  namespaces: string[];
}

/**
 * Narrows a list to Headlamp's selected namespaces (the "Namespace [ ... ]" filter, stored in
 * redux), mirroring what the table below it shows so a summary can count the same rows.
 */
export function scopeToNamespaces<T extends Namespaced>(
  items: T[] | null | undefined,
  selected: ReadonlySet<string> | undefined
): NamespaceScope<T> {
  const all = items ?? [];
  if (!selected || selected.size === 0) {
    return { items: all, total: all.length, namespaces: [] };
  }
  return {
    items: all.filter(item => {
      const namespace = item.getNamespace();
      return !namespace || selected.has(namespace);
    }),
    total: all.length,
    namespaces: [...selected].sort(),
  };
}
