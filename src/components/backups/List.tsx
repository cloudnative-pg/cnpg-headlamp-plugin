import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ColumnType,
  Link,
  ResourceListView,
  ResourceTableColumn,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Backup } from '../../resources/backup';
import { backupPhaseSeverity } from '../../resources/status';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchBackupCreate } from './Create';

const { createRouteURL } = Router;

export function BackupPhaseLabel({ backup }: { backup: Backup }) {
  const phase = backup.phase;
  const label = backupPhaseStatusLabel(phase);
  // CNPG's own `kubectl get backups` prints an Error column next to Phase, because a bare "failed"
  // chip gives an operator nothing to act on. Surface that same text on hover rather than making
  // them open the detail page to find out why. Mirrors DatabaseAppliedLabel, which already inlines
  // status.message on failure.
  if (backup.error) {
    return (
      <Tooltip title={backup.error}>
        <span>{label}</span>
      </Tooltip>
    );
  }
  return label;
}

function backupPhaseStatusLabel(phase: string | undefined) {
  return <StatusLabel status={backupPhaseSeverity(phase)}>{phase ?? '-'}</StatusLabel>;
}

function backupStats(backups: Backup[]): SummaryStat[] {
  const total = backups.length;
  const completed = backups.filter(b => b.phase === 'completed').length;
  const failed = backups.filter(b => backupPhaseSeverity(b.phase) === 'error').length;
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
    <ListPageHeader title="Backups" actions={backupActions()} stats={backupStats(backups ?? [])} />
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
            stats={backupStats(filteredBackups ?? [])}
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
