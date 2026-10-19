import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  ColumnType,
  HoverInfoLabel,
  Link,
  ResourceListView,
  ResourceTableColumn,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import cronstrue from 'cronstrue';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ScheduledBackup } from '../../resources/scheduledbackup';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchScheduledBackupCreate } from './Create';
import { launchTriggerBackup } from './TriggerBackup';

const { createRouteURL } = Router;

export function ScheduledBackupSuspendLabel({
  scheduledBackup,
}: {
  scheduledBackup: ScheduledBackup;
}) {
  return scheduledBackup.suspend ? (
    <StatusLabel status="warning">Suspended</StatusLabel>
  ) : (
    <StatusLabel status="success">Active</StatusLabel>
  );
}

export function ScheduledBackupScheduleLabel({ schedule }: { schedule: string }) {
  let described = '';
  try {
    described = cronstrue.toString(schedule);
  } catch {
    // Leave the tooltip empty for expressions cronstrue can't describe.
  }
  return <HoverInfoLabel label={schedule} hoverInfo={described} />;
}

function scheduledBackupStats(items: ScheduledBackup[]): SummaryStat[] {
  const total = items.length;
  const active = items.filter(item => !item.suspend).length;
  const suspended = total - active;
  return [
    { value: total, label: total === 1 ? 'Scheduled Backup' : 'Scheduled Backups' },
    { value: active, label: 'Active' },
    { value: suspended, label: 'Suspended', highlight: suspended > 0 },
  ];
}

function scheduledBackupColumns(): (ResourceTableColumn<ScheduledBackup> | ColumnType)[] {
  return [
    {
      id: 'name',
      label: 'Name',
      getValue: (item: ScheduledBackup) => item.getName(),
      render: (item: ScheduledBackup) => <Link kubeObject={item} />,
    },
    'namespace',
    {
      id: 'cluster',
      label: 'Cluster',
      getValue: (item: ScheduledBackup) => item.clusterName,
    },
    {
      id: 'schedule',
      label: 'Schedule',
      getValue: (item: ScheduledBackup) => item.schedule,
      render: (item: ScheduledBackup) => <ScheduledBackupScheduleLabel schedule={item.schedule} />,
    },
    {
      id: 'status',
      label: 'Status',
      getValue: (item: ScheduledBackup) => (item.suspend ? 'Suspended' : 'Active'),
      render: (item: ScheduledBackup) => <ScheduledBackupSuspendLabel scheduledBackup={item} />,
    },
    {
      id: 'lastScheduleTime',
      label: 'Last Run',
      getValue: (item: ScheduledBackup) => item.lastScheduleTime ?? '-',
    },
    {
      id: 'nextScheduleTime',
      label: 'Next Run',
      getValue: (item: ScheduledBackup) => item.nextScheduleTime ?? '-',
    },
    'age',
    {
      id: 'actions',
      label: '',
      getValue: () => '',
      render: (item: ScheduledBackup) => (
        <ActionButton
          description="Trigger Backup Now"
          icon="mdi:play-circle-outline"
          onClick={() => launchTriggerBackup(item)}
        />
      ),
    },
  ];
}

function scheduledBackupActions(): ReactNode[] {
  return [
    <AuthDisabledButton
      key="create-scheduled-backup"
      item={ScheduledBackup}
      authVerb="create"
      deniedMessage="You don't have permission to create ScheduledBackups."
    >
      <Button variant="contained" color="primary" onClick={() => launchScheduledBackupCreate()}>
        Create Scheduled Backup
      </Button>
    </AuthDisabledButton>,
  ];
}

function ScheduledBackupListTitleDefault() {
  const [backups] = ScheduledBackup.useList();
  return (
    <ListPageHeader
      title="Scheduled Backups"
      actions={scheduledBackupActions()}
      stats={scheduledBackupStats(backups ?? [])}
    />
  );
}

export function ScheduledBackupsList() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const clusterFilter = params.get('cluster');
  const namespaceFilter = params.get('namespace');

  // "View Scheduled Backups" on the Cluster detail page links here with ?cluster=&namespace= to
  // pre-filter — same client-side-filter approach as BackupsList, since ScheduledBackup has no
  // label back to its cluster.
  const [allScheduledBackups] = ScheduledBackup.useList({
    namespace: namespaceFilter ?? undefined,
  });
  const filteredScheduledBackups = clusterFilter
    ? (allScheduledBackups ?? []).filter(item => item.clusterName === clusterFilter)
    : null;

  if (clusterFilter) {
    return (
      <ResourceListView
        title={
          <ListPageHeader
            title={`Scheduled Backups for ${clusterFilter}`}
            actions={scheduledBackupActions()}
            stats={scheduledBackupStats(filteredScheduledBackups ?? [])}
          />
        }
        backLink={createRouteURL('CNPG Cluster', {
          namespace: namespaceFilter,
          name: clusterFilter,
        })}
        data={filteredScheduledBackups}
        id="cnpg-scheduled-backups"
        columns={scheduledBackupColumns()}
      />
    );
  }

  return (
    <ResourceListView
      title={<ScheduledBackupListTitleDefault />}
      resourceClass={ScheduledBackup}
      id="cnpg-scheduled-backups"
      columns={scheduledBackupColumns()}
    />
  );
}
