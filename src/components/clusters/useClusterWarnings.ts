import { Backup } from '../../resources/backup';
import { Cluster, ClusterWarning } from '../../resources/cluster';

/**
 * The cluster's warnings, with "Last backup failed" held back while a backup is running. For
 * places that only have a cluster (list rows); pages that already hold the Backups should call
 * `cluster.getWarnings(backups)` directly.
 */
export function useClusterWarnings(cluster: Cluster): ClusterWarning[] {
  const [backups] = Backup.useList({ namespace: cluster.getNamespace() });
  return cluster.getWarnings(backups);
}

export function warningsSummary(warnings: ClusterWarning[]): string {
  return warnings.map(w => w.message).join(' · ');
}

export function warningsColor(warnings: ClusterWarning[]): 'error.main' | 'warning.main' {
  return warnings.some(w => w.severity === 'error') ? 'error.main' : 'warning.main';
}
