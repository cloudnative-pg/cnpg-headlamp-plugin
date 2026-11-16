import { isBackupInProgress, parseBool } from './status';

/**
 * Cluster warning logic, kept free of any `@kinvolk/headlamp-plugin` import for the same reason as
 * `status.ts`: the Cluster resource class can't be loaded by vitest, so the plain-data rules live
 * here and are unit-tested directly. `Cluster.getWarnings` is a thin wrapper around them.
 */

export const CONDITION_CONTINUOUS_ARCHIVING = 'ContinuousArchiving';
export const CONDITION_LAST_BACKUP_SUCCEEDED = 'LastBackupSucceeded';

export interface ClusterWarning {
  id: 'wal-archiving' | 'last-backup';
  message: string;
  /** error (red) for problems that can escalate, e.g. WAL piling up; warning (yellow) otherwise. */
  severity: 'warning' | 'error';
  /** Longer explanation of the consequence, for tooltips and banners. */
  details?: string;
  /** When the underlying condition last changed, i.e. roughly how long the problem has lasted. */
  since?: string;
  /** The operator's own message from the condition, if any (e.g. the archiver's error). */
  conditionMessage?: string;
}

/** Why a failing WAL archive matters — shown wherever the warning is explained. */
const WAL_ARCHIVING_FAILING_DETAILS =
  "WAL files are not being archived. They accumulate on the primary's disk (which can fill it and stop the primary) and point-in-time recovery cannot advance past the last archived WAL.";

export interface WarningCondition {
  type: string;
  status: string;
  message?: string;
  lastTransitionTime?: string;
}

interface BackupLike {
  phase?: string;
  clusterName: string;
  getNamespace(): string;
}

/** Tri-state value of a condition: true/false, or undefined when absent or 'Unknown'. */
export function conditionState(
  conditions: WarningCondition[] | undefined,
  type: string
): boolean | undefined {
  return parseBool(conditions?.find(condition => condition.type === type)?.status);
}

/** True if one of the Backups of the given cluster is still in flight. */
export function hasBackupInProgressFor(
  clusterName: string,
  namespace: string,
  backups: BackupLike[] | null | undefined
): boolean {
  return (backups ?? []).some(
    backup =>
      isBackupInProgress(backup.phase) &&
      backup.clusterName === clusterName &&
      backup.getNamespace() === namespace
  );
}

/**
 * Warnings that don't affect cluster health but deserve attention: WAL archiving failing (red)
 * and the last backup not having succeeded (yellow). Empty when hibernated (no status to judge).
 * While a backup is in flight, "Last backup failed" is omitted — that failure belongs to the
 * previous backup, and a new one is already running.
 */
export function computeClusterWarnings(
  conditions: WarningCondition[] | undefined,
  { hibernated, backupInProgress }: { hibernated: boolean; backupInProgress: boolean }
): ClusterWarning[] {
  if (hibernated) {
    return [];
  }
  const warnings: ClusterWarning[] = [];
  if (conditionState(conditions, CONDITION_CONTINUOUS_ARCHIVING) === false) {
    const condition = conditions?.find(c => c.type === CONDITION_CONTINUOUS_ARCHIVING);
    warnings.push({
      id: 'wal-archiving',
      message: 'WAL archiving failing',
      severity: 'error',
      details: WAL_ARCHIVING_FAILING_DETAILS,
      since: condition?.lastTransitionTime,
      conditionMessage: condition?.message,
    });
  }
  if (conditionState(conditions, CONDITION_LAST_BACKUP_SUCCEEDED) === false && !backupInProgress) {
    warnings.push({ id: 'last-backup', message: 'Last backup failed', severity: 'warning' });
  }
  return warnings;
}
