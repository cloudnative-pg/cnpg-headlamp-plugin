import { describe, expect, it } from 'vitest';
import { collectEdited, diffParameters, toMergePatch, validateExtras } from './diff';
import { CURATED_PARAMETER_NAMES, PARAMETER_GROUPS } from './parameters';

describe('curated parameters', () => {
  it('has no duplicate names', () => {
    const all = PARAMETER_GROUPS.flatMap(g => g.parameters.map(p => p.name));
    expect(new Set(all).size).toBe(all.length);
  });

  it('only suggests options that include every example for enum-like fields', () => {
    for (const parameter of PARAMETER_GROUPS.flatMap(g => g.parameters)) {
      if (parameter.options) {
        for (const example of parameter.examples) {
          expect(parameter.options).toContain(example);
        }
      }
    }
  });
});

describe('collectEdited', () => {
  it('trims values and treats empty ones as unset', () => {
    expect(
      collectEdited({ work_mem: ' 16MB ', shared_buffers: '' }, [
        { id: 1, key: ' foo ', value: ' bar ' },
        { id: 2, key: 'baz', value: '' },
        { id: 3, key: '', value: '' },
      ])
    ).toEqual({ work_mem: '16MB', foo: 'bar' });
  });
});

describe('diffParameters', () => {
  const current = { shared_buffers: '256MB', work_mem: '4MB', archive_timeout: '5min' };

  it('returns nothing when unchanged', () => {
    expect(diffParameters(current, { ...current })).toEqual([]);
  });

  it('ignores operator-managed keys and empty current values', () => {
    expect(
      diffParameters({ shared_preload_libraries: 'pg_stat_statements', work_mem: '' }, {})
    ).toEqual([]);
  });

  it('reports additions, changes and removals, flagging restarts', () => {
    const changes = diffParameters(current, {
      shared_buffers: '1GB',
      work_mem: '4MB',
      log_lock_waits: 'on',
    });
    expect(changes).toEqual([
      { key: 'archive_timeout', from: '5min', to: undefined, restart: false },
      { key: 'log_lock_waits', from: undefined, to: 'on', restart: false },
      { key: 'shared_buffers', from: '256MB', to: '1GB', restart: true },
    ]);
  });
});

describe('toMergePatch', () => {
  it('uses null for removals and leaves unchanged keys out', () => {
    const changes = diffParameters({ a: '1', b: '2', c: '3' }, { a: '1', b: '20' });
    expect(toMergePatch(changes)).toEqual({ b: '20', c: null });
  });
});

describe('validateExtras', () => {
  it('flags missing names, bad names, curated keys and duplicates', () => {
    const errors = validateExtras([
      { id: 1, key: '', value: 'x' },
      { id: 2, key: 'a b', value: 'x' },
      { id: 3, key: 'work_mem', value: '1MB' },
      { id: 4, key: 'foo', value: '1' },
      { id: 5, key: 'foo', value: '2' },
      { id: 6, key: '', value: '' },
    ]);
    expect(Object.keys(errors).map(Number).sort()).toEqual([1, 2, 3, 5]);
    expect(CURATED_PARAMETER_NAMES.has('work_mem')).toBe(true);
  });
});
