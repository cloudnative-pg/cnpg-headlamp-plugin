import { Link, ResourceListView, StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { Pooler } from '../../resources/pooler';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchPoolerCreate } from './Create';

export function PoolerStatusLabel({ pooler }: { pooler: Pooler }) {
  if (pooler.isPaused) {
    return <StatusLabel status="warning">Paused</StatusLabel>;
  }
  if (pooler.phase === 'active') {
    return <StatusLabel status="success">{pooler.phase}</StatusLabel>;
  }
  return <StatusLabel status="">{pooler.phase ?? '-'}</StatusLabel>;
}

function poolerStats(poolers: Pooler[]): SummaryStat[] {
  const total = poolers.length;
  const paused = poolers.filter(p => p.isPaused).length;
  const active = poolers.filter(p => !p.isPaused && p.phase === 'active').length;
  return [
    { value: total, label: total === 1 ? 'Pooler' : 'Poolers' },
    { value: active, label: 'Active' },
    { value: paused, label: 'Paused', highlight: paused > 0 },
  ];
}

function PoolerListTitle() {
  const [poolers] = Pooler.useList();
  return (
    <ListPageHeader
      title="Poolers"
      actions={[
        <AuthDisabledButton
          key="create-pooler"
          item={Pooler}
          authVerb="create"
          deniedMessage="You don't have permission to create Poolers."
        >
          <Button variant="contained" color="primary" onClick={() => launchPoolerCreate()}>
            Create Pooler
          </Button>
        </AuthDisabledButton>,
      ]}
      stats={poolerStats(poolers ?? [])}
    />
  );
}

export function PoolersList() {
  return (
    <ResourceListView
      title={<PoolerListTitle />}
      resourceClass={Pooler}
      id="cnpg-poolers"
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => <Link kubeObject={item} />,
        },
        'namespace',
        {
          id: 'cluster',
          label: 'Cluster',
          getValue: item => item.clusterName,
        },
        {
          id: 'type',
          label: 'Type',
          getValue: item => item.type,
        },
        {
          id: 'poolMode',
          label: 'Pool Mode',
          getValue: item => item.poolMode ?? '-',
        },
        {
          id: 'instances',
          label: 'Instances',
          getValue: item => item.instances,
        },
        {
          id: 'status',
          label: 'Status',
          getValue: item => (item.isPaused ? 'Paused' : item.phase ?? ''),
          render: item => <PoolerStatusLabel pooler={item} />,
        },
        'age',
      ]}
    />
  );
}
