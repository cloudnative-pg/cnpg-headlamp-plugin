import { describe, expect, it } from 'vitest';
import { formatFullTimestamp, parseCnpgLogLines, parseTimestamp, prettyJson } from './cnpgLog';

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

describe('parseTimestamp', () => {
  it('parses epoch seconds (float)', () => {
    expect(parseTimestamp(1700000000.5)?.getTime()).toBe(1700000000500);
  });

  it('parses an ISO string', () => {
    expect(parseTimestamp('2026-10-20T00:00:00Z')?.getTime()).toBe(
      Date.parse('2026-10-20T00:00:00Z')
    );
  });

  it('returns undefined for missing or invalid values', () => {
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp(null)).toBeUndefined();
    expect(parseTimestamp('')).toBeUndefined();
    expect(parseTimestamp('not a date')).toBeUndefined();
  });
});

describe('formatFullTimestamp', () => {
  it('formats epoch seconds as ISO and falls back to the raw value', () => {
    expect(formatFullTimestamp(1700000000.5)).toBe(new Date(1700000000500).toISOString());
    expect(formatFullTimestamp('garbage')).toBe('garbage');
  });
});

describe('prettyJson', () => {
  it('pretty-prints valid JSON and passes invalid input through', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson('not json')).toBe('not json');
  });
});
