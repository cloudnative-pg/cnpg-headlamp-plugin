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
import { Database } from '../../resources/database';
import { AppliedStatusLabel } from '../common/AppliedStatusLabel';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchDatabaseCreate } from './Create';

const { createRouteURL } = Router;

export function DatabaseAppliedLabel({ database }: { database: Database }) {
  return <AppliedStatusLabel applied={database.applied} message={database.message} />;
}

function databaseStats(items: Database[]): SummaryStat[] {
  const total = items.length;
  const applied = items.filter(item => item.applied === true).length;
  const needsAttention = items.filter(item => item.applied === false).length;
  return [
    { value: total, label: total === 1 ? 'Database' : 'Databases' },
    { value: applied, label: 'Applied' },
    { value: needsAttention, label: 'Needs attention', highlight: needsAttention > 0 },
  ];
}

function databaseColumns(): (ResourceTableColumn<Database> | ColumnType)[] {
  return [
    {
      id: 'name',
      label: 'Name',
      getValue: (item: Database) => item.getName(),
      render: (item: Database) => <Link kubeObject={item} />,
    },
    'namespace',
    {
      id: 'cluster',
      label: 'Cluster',
      getValue: (item: Database) => item.clusterName,
    },
    {
      id: 'pgName',
      label: 'PG Name',
      getValue: (item: Database) => item.pgName,
    },
    {
      id: 'owner',
      label: 'Owner',
      getValue: (item: Database) => item.owner,
    },
    {
      id: 'ensure',
      label: 'Ensure',
      getValue: (item: Database) => item.ensure,
    },
    {
      id: 'applied',
      label: 'Status',
      getValue: (item: Database) => (item.applied ? 'Applied' : item.message ?? 'Unknown'),
      render: (item: Database) => <DatabaseAppliedLabel database={item} />,
    },
    'age',
  ];
}

function databaseActions(): ReactNode[] {
  return [
    <AuthDisabledButton
      key="create-database"
      item={Database}
      authVerb="create"
      deniedMessage="You don't have permission to create Databases."
    >
      <Button variant="contained" color="primary" onClick={() => launchDatabaseCreate()}>
        Create Database
      </Button>
    </AuthDisabledButton>,
  ];
}

function DatabaseListTitleDefault() {
  const [databases] = Database.useList();
  return (
    <ListPageHeader
      title="Databases"
      actions={databaseActions()}
      stats={databaseStats(databases ?? [])}
    />
  );
}

export function DatabasesList() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const clusterFilter = params.get('cluster');
  const namespaceFilter = params.get('namespace');

  // "View Databases" on the Cluster detail page links here with ?cluster=&namespace= to
  // pre-filter — same client-side-filter approach as ScheduledBackupsList, since Database has no
  // label back to its cluster.
  const [allDatabases] = Database.useList({
    namespace: namespaceFilter ?? undefined,
  });
  const filteredDatabases = clusterFilter
    ? (allDatabases ?? []).filter(item => item.clusterName === clusterFilter)
    : null;

  if (clusterFilter) {
    return (
      <ResourceListView
        title={
          <ListPageHeader
            title={`Databases for ${clusterFilter}`}
            actions={databaseActions()}
            stats={databaseStats(filteredDatabases ?? [])}
          />
        }
        backLink={createRouteURL('CNPG Cluster', {
          namespace: namespaceFilter,
          name: clusterFilter,
        })}
        data={filteredDatabases}
        id="cnpg-databases"
        columns={databaseColumns()}
      />
    );
  }

  return (
    <ResourceListView
      title={<DatabaseListTitleDefault />}
      resourceClass={Database}
      id="cnpg-databases"
      columns={databaseColumns()}
    />
  );
}
