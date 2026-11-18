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
  stoppedAt?: string;
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

/** When the most recent completed Backup of the given cluster finished, if any. */
export function lastCompletedBackupAt(
  clusterName: string,
  namespace: string,
  backups: BackupLike[] | null | undefined
): string | undefined {
  return (backups ?? [])
    .filter(
      backup =>
        backup.phase === 'completed' &&
        backup.stoppedAt &&
        backup.clusterName === clusterName &&
        backup.getNamespace() === namespace
    )
    .map(backup => backup.stoppedAt as string)
    .sort()
    .pop();
}

/** True if `completedAt` is at or after `since` (both RFC 3339); false if either is missing. */
function isCompletedSince(completedAt: string | undefined, since: string | undefined): boolean {
  const completed = completedAt ? Date.parse(completedAt) : NaN;
  const failed = since ? Date.parse(since) : NaN;
  return !Number.isNaN(completed) && !Number.isNaN(failed) && completed >= failed;
}

/**
 * Warnings that don't affect cluster health but deserve attention: WAL archiving failing (red)
 * and the last backup not having succeeded (yellow). Empty when hibernated (no status to judge).
 * While a backup is in flight, "Last backup failed" is omitted — that failure belongs to the
 * previous backup, and a new one is already running. The same goes for a backup that has already
 * completed after the condition turned False: the operator updates the cluster condition a moment
 * after the Backup reaches `completed`, and until then the condition is stale.
 */
export function computeClusterWarnings(
  conditions: WarningCondition[] | undefined,
  {
    hibernated,
    backupInProgress,
    lastCompletedBackupAt,
  }: { hibernated: boolean; backupInProgress: boolean; lastCompletedBackupAt?: string }
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
  const lastBackupCondition = conditions?.find(c => c.type === CONDITION_LAST_BACKUP_SUCCEEDED);
  if (
    conditionState(conditions, CONDITION_LAST_BACKUP_SUCCEEDED) === false &&
    !backupInProgress &&
    !isCompletedSince(lastCompletedBackupAt, lastBackupCondition?.lastTransitionTime)
  ) {
    warnings.push({ id: 'last-backup', message: 'Last backup failed', severity: 'warning' });
  }
  return warnings;
}
