import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ColumnType,
  Link,
  ResourceListView,
  ResourceTableColumn,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Backup } from '../../resources/backup';
import { backupPhaseStatus } from '../../resources/status';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { StatusChip } from '../common/SeverityStatus';
import { launchBackupCreate } from './Create';

const { createRouteURL } = Router;

// CNPG's own `kubectl get backups` prints an Error column next to Phase, because a bare "failed"
// chip gives an operator nothing to act on, so status.error is added to the chip's tooltip.
export function BackupPhaseLabel({ backup }: { backup: Backup }) {
  return <StatusChip status={backupPhaseStatus(backup.phase, backup.error)} />;
}

function backupStats(backups: Backup[]): SummaryStat[] {
  const total = backups.length;
  const completed = backups.filter(b => b.phase === 'completed').length;
  const failed = backups.filter(b => backupPhaseStatus(b.phase).severity === 'error').length;
  return [
    { value: total, label: total === 1 ? 'Backup' : 'Backups' },
    { value: completed, label: 'Completed' },
    { value: failed, label: 'Failed', highlight: failed > 0 },
  ];
}

function backupColumns(): (ResourceTableColumn<Backup> | ColumnType)[] {
  return [
    {
      id: 'name',
      label: 'Name',
      getValue: (item: Backup) => item.getName(),
      render: (item: Backup) => <Link kubeObject={item} />,
    },
    'namespace',
    {
      id: 'cluster',
      label: 'Cluster',
      getValue: (item: Backup) => item.clusterName,
    },
    {
      id: 'method',
      label: 'Method',
      getValue: (item: Backup) => item.method,
    },
    {
      id: 'phase',
      label: 'Phase',
      getValue: (item: Backup) => item.phase ?? '-',
      render: (item: Backup) => <BackupPhaseLabel backup={item} />,
    },
    'age',
  ];
}

function backupActions(): ReactNode[] {
  return [
    <AuthDisabledButton
      key="create-backup"
      item={Backup}
      authVerb="create"
      allowedNamespacesHint
      deniedMessage="You don't have permission to create Backups."
    >
      <Button variant="contained" color="primary" onClick={() => launchBackupCreate()}>
        Create Backup
      </Button>
    </AuthDisabledButton>,
  ];
}

function BackupListTitleDefault() {
  const [backups] = Backup.useList();
  return (
    <ListPageHeader
      title="Backups"
      actions={backupActions()}
      items={backups}
      getStats={backupStats}
    />
  );
}

export function BackupsList() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const clusterFilter = params.get('cluster');
  const namespaceFilter = params.get('namespace');

  // "View Backups" on the Cluster detail page links here with ?cluster=&namespace= to pre-filter
  // — Backup has no label back to its cluster, so we fetch the namespace's backups and filter
  // client-side, same approach as PoolersSection/ReferringClustersSection.
  const [allBackups] = Backup.useList({ namespace: namespaceFilter ?? undefined });
  const filteredBackups = clusterFilter
    ? (allBackups ?? []).filter(backup => backup.clusterName === clusterFilter)
    : null;

  if (clusterFilter) {
    return (
      <ResourceListView
        title={
          <ListPageHeader
            title={`Backups for ${clusterFilter}`}
            actions={backupActions()}
            items={filteredBackups}
            getStats={backupStats}
          />
        }
        backLink={createRouteURL('CNPG Cluster', {
          namespace: namespaceFilter,
          name: clusterFilter,
        })}
        data={filteredBackups}
        id="cnpg-backups"
        columns={backupColumns()}
      />
    );
  }

  return (
    <ResourceListView
      title={<BackupListTitleDefault />}
      resourceClass={Backup}
      id="cnpg-backups"
      columns={backupColumns()}
    />
  );
}
