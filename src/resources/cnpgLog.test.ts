import { describe, expect, it } from 'vitest';
import { parseCnpgLogLines } from './cnpgLog';

describe('parseCnpgLogLines', () => {
  it('splits bundled lines', () => {
    const out = parseCnpgLogLines(['{"level":"info","msg":"a"}\n{"level":"error","msg":"b"}\n']);
    expect(out.map(e => e.message)).toEqual(['a', 'b']);
  });

  it('rejoins a JSON line split across two entries', () => {
    const out = parseCnpgLogLines([
      '{"level":"info","msg":"first"}\n{"level":"error","ms',
      'g":"second"}\n{"level":"info","msg":"third"}',
    ]);
    expect(out.map(e => [e.severity, e.message])).toEqual([
      ['INFO', 'first'],
      ['ERROR', 'second'],
      ['INFO', 'third'],
    ]);
  });

  it('keeps an incomplete trailing fragment as a raw line', () => {
    const out = parseCnpgLogLines(['{"level":"info","msg":"a"}\n{"level":"er']);
    expect(out).toHaveLength(2);
    expect(out[1].severity).toBe('');
  });
});
