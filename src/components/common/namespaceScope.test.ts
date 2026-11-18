import { describe, expect, it } from 'vitest';
import { scopeToNamespaces } from './namespaceScope';

const item = (namespace: string | undefined) => ({ getNamespace: () => namespace });
const items = [item('a'), item('a'), item('b'), item('c')];

describe('scopeToNamespaces', () => {
  it('keeps everything when no namespace is selected', () => {
    const scope = scopeToNamespaces(items, new Set());
    expect(scope).toMatchObject({ total: 4, namespaces: [] });
    expect(scope.items).toHaveLength(4);
    expect(scopeToNamespaces(items, undefined).items).toHaveLength(4);
  });

  it('narrows to the selected namespaces and keeps the unfiltered total', () => {
    const scope = scopeToNamespaces(items, new Set(['b', 'a']));
    expect(scope.items).toHaveLength(3);
    expect(scope.total).toBe(4);
    expect(scope.namespaces).toEqual(['a', 'b']);
  });

  it('can end up empty', () => {
    const scope = scopeToNamespaces(items, new Set(['zzz']));
    expect(scope.items).toHaveLength(0);
    expect(scope.total).toBe(4);
  });

  it('never hides cluster-scoped items', () => {
    const scope = scopeToNamespaces([item(undefined), item('a')], new Set(['b']));
    expect(scope.items).toHaveLength(1);
  });

  it('handles a list that has not loaded', () => {
    expect(scopeToNamespaces(null, new Set(['a']))).toEqual({
      items: [],
      total: 0,
      namespaces: ['a'],
    });
  });
});
