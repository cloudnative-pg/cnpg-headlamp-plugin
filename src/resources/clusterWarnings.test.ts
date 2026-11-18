import { describe, expect, it } from 'vitest';
import {
  computeClusterWarnings,
  conditionState,
  hasBackupInProgressFor,
  lastCompletedBackupAt,
  WarningCondition,
} from './clusterWarnings';

const cond = (type: string, status: string, extra: object = {}): WarningCondition => ({
  type,
  status,
  ...extra,
});
const archiving = (status: string, extra: object = {}) =>
  cond('ContinuousArchiving', status, extra);
const lastBackup = (status: string) => cond('LastBackupSucceeded', status);

const backup = (phase: string, clusterName = 'pg', namespace = 'db', stoppedAt?: string) => ({
  phase,
  stoppedAt,
  clusterName,
  getNamespace: () => namespace,
});

const idle = { hibernated: false, backupInProgress: false };
const ids = (conditions: WarningCondition[], opts = idle) =>
  computeClusterWarnings(conditions, opts).map(w => w.id);

describe('conditionState', () => {
  it.each([
    ['True', true],
    ['False', false],
    ['Unknown', undefined],
  ])('status %s -> %s', (status, expected) => {
    expect(conditionState([lastBackup(status)], 'LastBackupSucceeded')).toBe(expected);
  });

  it('is undefined when the condition or the list is absent', () => {
    expect(conditionState([], 'LastBackupSucceeded')).toBeUndefined();
    expect(conditionState(undefined, 'LastBackupSucceeded')).toBeUndefined();
  });
});

describe('hasBackupInProgressFor', () => {
  it.each(['pending', 'started', 'running', 'finalizing'])('%s is in progress', phase => {
    expect(hasBackupInProgressFor('pg', 'db', [backup(phase)])).toBe(true);
  });

  it.each(['completed', 'failed', 'walArchivingFailing', 'invalid backup definition'])(
    '%s is not',
    phase => {
      expect(hasBackupInProgressFor('pg', 'db', [backup(phase)])).toBe(false);
    }
  );

  it('ignores backups of other clusters and namespaces', () => {
    expect(hasBackupInProgressFor('pg', 'db', [backup('running', 'other')])).toBe(false);
    expect(hasBackupInProgressFor('pg', 'db', [backup('running', 'pg', 'elsewhere')])).toBe(false);
  });

  it('finds an in-flight backup among finished ones', () => {
    const backups = [backup('completed'), backup('failed'), backup('running')];
    expect(hasBackupInProgressFor('pg', 'db', backups)).toBe(true);
  });

  it('handles a list that has not loaded', () => {
    expect(hasBackupInProgressFor('pg', 'db', null)).toBe(false);
    expect(hasBackupInProgressFor('pg', 'db', undefined)).toBe(false);
  });
});

describe('computeClusterWarnings', () => {
  it('has no warnings when all is well or nothing is reported', () => {
    expect(ids([lastBackup('True'), archiving('True')])).toEqual([]);
    expect(ids([])).toEqual([]);
    expect(computeClusterWarnings(undefined, idle)).toEqual([]);
  });

  it('does not warn on Unknown conditions (e.g. a backup that just started)', () => {
    expect(ids([lastBackup('Unknown'), archiving('Unknown')])).toEqual([]);
  });

  it('warns "last backup failed" in yellow', () => {
    const [warning] = computeClusterWarnings([lastBackup('False')], idle);
    expect(warning).toMatchObject({ id: 'last-backup', severity: 'warning' });
  });

  it('warns about WAL archiving in red, with details, since and the operator message', () => {
    const [warning] = computeClusterWarnings(
      [
        archiving('False', {
          lastTransitionTime: '2026-01-01T00:00:00Z',
          message: 'access denied',
        }),
      ],
      idle
    );
    expect(warning).toMatchObject({
      id: 'wal-archiving',
      severity: 'error',
      since: '2026-01-01T00:00:00Z',
      conditionMessage: 'access denied',
    });
    expect(warning.details).toMatch(/not being archived/);
  });

  it('lists WAL archiving before the last backup when both fail', () => {
    expect(ids([lastBackup('False'), archiving('False')])).toEqual([
      'wal-archiving',
      'last-backup',
    ]);
  });

  it('holds back "last backup failed" while a backup is in progress', () => {
    const inFlight = { hibernated: false, backupInProgress: true };
    expect(ids([lastBackup('False')], inFlight)).toEqual([]);
  });

  it('keeps the WAL archiving warning while a backup is in progress', () => {
    const inFlight = { hibernated: false, backupInProgress: true };
    expect(ids([archiving('False'), lastBackup('False')], inFlight)).toEqual(['wal-archiving']);
  });

  it('has no warnings for a hibernated cluster', () => {
    const hibernated = { hibernated: true, backupInProgress: false };
    expect(ids([lastBackup('False'), archiving('False')], hibernated)).toEqual([]);
  });
});

describe('lastCompletedBackupAt', () => {
  it('returns the latest stoppedAt among completed backups of the cluster', () => {
    const backups = [
      backup('completed', 'pg', 'db', '2026-01-01T10:00:00Z'),
      backup('completed', 'pg', 'db', '2026-01-01T12:00:00Z'),
      backup('failed', 'pg', 'db', '2026-01-01T13:00:00Z'),
      backup('completed', 'other', 'db', '2026-01-01T14:00:00Z'),
    ];
    expect(lastCompletedBackupAt('pg', 'db', backups)).toBe('2026-01-01T12:00:00Z');
  });

  it('is undefined with no completed backup', () => {
    expect(lastCompletedBackupAt('pg', 'db', [backup('running')])).toBeUndefined();
    expect(lastCompletedBackupAt('pg', 'db', null)).toBeUndefined();
  });
});

describe('a backup that completed before the operator updated the condition', () => {
  const failedAt = (time: string) =>
    cond('LastBackupSucceeded', 'False', { lastTransitionTime: time });
  const opts = (lastCompletedBackupAt?: string) => ({
    hibernated: false,
    backupInProgress: false,
    lastCompletedBackupAt,
  });

  it('is not reported as a failure while the condition is still stale', () => {
    const warnings = computeClusterWarnings(
      [failedAt('2026-01-01T10:00:00Z')],
      opts('2026-01-01T11:00:00Z')
    );
    expect(warnings).toEqual([]);
  });

  it('still warns when the failure is newer than the last completed backup', () => {
    const warnings = computeClusterWarnings(
      [failedAt('2026-01-01T12:00:00Z')],
      opts('2026-01-01T11:00:00Z')
    );
    expect(warnings.map(w => w.id)).toEqual(['last-backup']);
  });

  it('still warns when no backup ever completed, or timestamps are missing', () => {
    expect(computeClusterWarnings([failedAt('2026-01-01T10:00:00Z')], opts()).length).toBe(1);
    expect(
      computeClusterWarnings([cond('LastBackupSucceeded', 'False')], opts('2026-01-01T11:00:00Z'))
        .length
    ).toBe(1);
  });

  it('does not hide the WAL archiving warning', () => {
    const warnings = computeClusterWarnings(
      [failedAt('2026-01-01T10:00:00Z'), cond('ContinuousArchiving', 'False')],
      opts('2026-01-01T11:00:00Z')
    );
    expect(warnings.map(w => w.id)).toEqual(['wal-archiving']);
  });
});
