import { describe, expect, it } from 'vitest';
import { formatBackupDuration, formatBackupTime, formatLsn, parseListBackups } from './backups';

const SAMPLE_OUTPUT = `[{"name":"backup-20260929142216","clusterName":"cluster-example","startLsn":100877792,"endLsn":117440608,"startWal":"000000010000000000000006","endWal":"000000010000000000000007","tli":1,"segmentSize":16777216,"backupLabel":"START WAL LOCATION: 0/60345E0 (file 000000010000000000000006)\\nCHECKPOINT LOCATION: 0/6034670\\nBACKUP METHOD: streamed\\nBACKUP FROM: standby\\nSTART TIME: 2026-09-29 14:22:16 UTC\\nLABEL: backup-20260929142216\\nSTART TIMELINE: 1\\n","tablespaceMap":"","pgData":"/var/lib/postgresql/data/pgdata","annotations":{"klio.io/tier1":"present"},"startedAt":1790691736,"stoppedAt":1790691737}]`;

describe('parseListBackups', () => {
  it('parses the list-backups output', () => {
    expect(parseListBackups(SAMPLE_OUTPUT)).toEqual([
      {
        name: 'backup-20260929142216',
        clusterName: 'cluster-example',
        startWal: '000000010000000000000006',
        endWal: '000000010000000000000007',
        startLsn: 100877792,
        endLsn: 117440608,
        backupLabel: expect.stringContaining('BACKUP METHOD: streamed'),
        tier1: true,
        tier2: false,
        startedAt: 1790691736,
        stoppedAt: 1790691737,
      },
    ]);
  });

  it('parses an empty list', () => {
    expect(parseListBackups('[]')).toEqual([]);
  });

  it('rejects non-JSON output', () => {
    expect(() => parseListBackups('error: unknown command')).toThrow(
      'Output is not valid JSON.'
    );
  });

  it('rejects entries without name/clusterName', () => {
    expect(() => parseListBackups('[{"name":42}]')).toThrow(
      'Entry 0 has no name/clusterName.'
    );
  });
});

describe('formatLsn', () => {
  it('formats raw LSN integers as X/X', () => {
    expect(formatLsn(100877792)).toBe('0/60345E0');
    expect(formatLsn(117440608)).toBe('0/7000060');
    expect(formatLsn(undefined)).toBe('-');
  });
});

describe('formatBackupDuration', () => {
  it('formats elapsed time and guards bad input', () => {
    expect(formatBackupDuration(1790691736, 1790691737)).toBe('1s');
    expect(formatBackupDuration(0, 150)).toBe('2m 30s');
    expect(formatBackupDuration(0, 3900)).toBe('1h 5m');
    expect(formatBackupDuration(1790691736, undefined)).toBeNull();
    expect(formatBackupDuration(10, 5)).toBeNull();
  });
});

describe('formatBackupTime', () => {
  it('formats unix seconds and guards bad input', () => {
    expect(formatBackupTime(1790691736)).not.toBe('-');
    expect(formatBackupTime(undefined)).toBe('-');
  });
});
