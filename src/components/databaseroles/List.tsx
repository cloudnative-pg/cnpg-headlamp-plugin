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
import { DatabaseRole } from '../../resources/databaseRole';
import { AppliedStatusLabel } from '../common/AppliedStatusLabel';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchDatabaseRoleCreate } from './Create';

const { createRouteURL } = Router;

export function DatabaseRoleAppliedLabel({ databaseRole }: { databaseRole: DatabaseRole }) {
  return <AppliedStatusLabel applied={databaseRole.applied} message={databaseRole.message} />;
}

function databaseRoleStats(items: DatabaseRole[]): SummaryStat[] {
  const total = items.length;
  const applied = items.filter(item => item.applied === true).length;
  const needsAttention = items.filter(item => item.applied === false).length;
  return [
    { value: total, label: total === 1 ? 'Role' : 'Roles' },
    { value: applied, label: 'Applied' },
    { value: needsAttention, label: 'Needs attention', highlight: needsAttention > 0 },
  ];
}

function databaseRoleColumns(): (ResourceTableColumn<DatabaseRole> | ColumnType)[] {
  return [
    {
      id: 'name',
      label: 'Name',
      getValue: (item: DatabaseRole) => item.getName(),
      render: (item: DatabaseRole) => <Link kubeObject={item} />,
    },
    'namespace',
    {
      id: 'cluster',
      label: 'Cluster',
      getValue: (item: DatabaseRole) => item.clusterName,
    },
    {
      id: 'pgName',
      label: 'PG Name',
      getValue: (item: DatabaseRole) => item.pgName,
    },
    {
      id: 'login',
      label: 'Login',
      getValue: (item: DatabaseRole) => (item.login ? 'Yes' : 'No'),
    },
    {
      id: 'superuser',
      label: 'Superuser',
      getValue: (item: DatabaseRole) => (item.superuser ? 'Yes' : 'No'),
    },
    {
      id: 'ensure',
      label: 'Ensure',
      getValue: (item: DatabaseRole) => item.ensure,
    },
    {
      id: 'applied',
      label: 'Status',
      getValue: (item: DatabaseRole) => (item.applied ? 'Applied' : item.message ?? 'Unknown'),
      render: (item: DatabaseRole) => <DatabaseRoleAppliedLabel databaseRole={item} />,
    },
    'age',
  ];
}

function databaseRoleActions(): ReactNode[] {
  return [
    <AuthDisabledButton
      key="create-databaserole"
      item={DatabaseRole}
      authVerb="create"
      deniedMessage="You don't have permission to create DatabaseRoles."
    >
      <Button variant="contained" color="primary" onClick={() => launchDatabaseRoleCreate()}>
        Create Role
      </Button>
    </AuthDisabledButton>,
  ];
}

function DatabaseRoleListTitleDefault() {
  const [roles] = DatabaseRole.useList();
  return (
    <ListPageHeader
      title="Roles"
      actions={databaseRoleActions()}
      stats={databaseRoleStats(roles ?? [])}
    />
  );
}

export function DatabaseRolesList() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const clusterFilter = params.get('cluster');
  const namespaceFilter = params.get('namespace');

  // "View Roles" on the Cluster detail page links here with ?cluster=&namespace= to
  // pre-filter — same client-side-filter approach as DatabasesList, since DatabaseRole has no
  // label back to its cluster.
  const [allDatabaseRoles] = DatabaseRole.useList({
    namespace: namespaceFilter ?? undefined,
  });
  const filteredDatabaseRoles = clusterFilter
    ? (allDatabaseRoles ?? []).filter(item => item.clusterName === clusterFilter)
    : null;

  if (clusterFilter) {
    return (
      <ResourceListView
        title={
          <ListPageHeader
            title={`Roles for ${clusterFilter}`}
            actions={databaseRoleActions()}
            stats={databaseRoleStats(filteredDatabaseRoles ?? [])}
          />
        }
        backLink={createRouteURL('CNPG Cluster', {
          namespace: namespaceFilter,
          name: clusterFilter,
        })}
        data={filteredDatabaseRoles}
        id="cnpg-database-roles"
        columns={databaseRoleColumns()}
      />
    );
  }

  return (
    <ResourceListView
      title={<DatabaseRoleListTitleDefault />}
      resourceClass={DatabaseRole}
      id="cnpg-database-roles"
      columns={databaseRoleColumns()}
    />
  );
}
