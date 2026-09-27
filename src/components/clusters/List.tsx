import {
  ColumnType,
  Link,
  ResourceListView,
  ResourceTableColumn,
  SectionFilterHeader,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Cluster } from '../../resources/cluster';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { getClusterCreateUrl } from './create/CreatePage';

// "Restore" lands on the same guided page as "Create Cluster", just pre-switched to the
// recovery start option (restore from an object store) via ?start=recovery.
function RestoreMenu() {
  const history = useHistory();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <AuthDisabledButton
        item={Cluster}
        authVerb="create"
        deniedMessage="You don't have permission to restore Clusters."
      >
        <Button
          variant="outlined"
          onClick={e => setAnchorEl(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={open ? 'true' : undefined}
        >
          Restore ▾
        </Button>
      </AuthDisabledButton>
      <Menu anchorEl={anchorEl} open={open} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            history.push(getClusterCreateUrl({ start: 'recovery' }));
          }}
        >
          From backup
        </MenuItem>
      </Menu>
    </>
  );
}

// Summary strip rendered between the list header and the table:
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  8 Clusters     7 Healthy     1 Needs attention     24 Instances       │
// └─────────────────────────────────────────────────────────────────────────┘
//
// "Needs attention" is anything not fully healthy (Degraded + Unhealthy) — the per-row
// Status column below keeps the finer-grained label. Instance count is the desired
// spec.instances total, matching `kubectl get clusters` rather than live pod counts.
function ClusterSummaryBar() {
  // Global counts (all namespaces) — the table below may additionally be narrowed by
  // Headlamp's namespace filter, which lives in redux and doesn't affect this hook.
  const [clusters] = Cluster.useList();

  const total = clusters?.length ?? 0;
  const healthy = (clusters ?? []).filter(c => c.health === 'success').length;
  const needsAttention = total - healthy;
  const instances = (clusters ?? []).reduce((sum, c) => sum + c.instances, 0);

  const stats: { value: number; label: string; highlight?: boolean }[] = [
    { value: total, label: total === 1 ? 'Cluster' : 'Clusters' },
    { value: healthy, label: 'Healthy' },
    { value: needsAttention, label: 'Needs attention', highlight: needsAttention > 0 },
    { value: instances, label: 'Instances' },
  ];

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 3,
        py: 1.5,
        mb: 2,
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 5,
        rowGap: 1,
      }}
    >
      {stats.map(stat => (
        <Box key={stat.label} display="flex" alignItems="baseline" gap={1}>
          <Typography
            variant="h6"
            component="span"
            color={stat.highlight ? 'warning.main' : 'text.primary'}
          >
            {stat.value}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {stat.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const clusterColumns: (ResourceTableColumn<Cluster> | ColumnType)[] = [
  {
    id: 'cluster',
    label: 'Cluster',
    getValue: item => item.getName(),
    render: item => <Link kubeObject={item} />,
  },
  'namespace',
  {
    id: 'status',
    label: 'Status',
    getValue: item => item.healthLabel,
    render: item => <StatusLabel status={item.health}>{item.healthLabel}</StatusLabel>,
  },
  {
    id: 'primary',
    label: 'Primary',
    getValue: item => item.currentPrimary ?? '',
    render: item => <>{item.currentPrimary ?? '-'}</>,
  },
  {
    id: 'instances',
    label: 'Instances',
    getValue: item => `${item.readyInstances}/${item.instances}`,
    render: item => (
      <Box lineHeight={1.25}>
        <Box>
          {item.readyInstances} / {item.instances}
        </Box>
        <Typography variant="caption" color="text.secondary">
          Ready
        </Typography>
      </Box>
    ),
  },
  {
    id: 'replication',
    label: 'Replication',
    getValue: item => (item.hasSynchronousReplication ? 'Enabled' : 'Disabled'),
    render: item => (item.hasSynchronousReplication ? '✓ Enabled' : '— Disabled'),
  },
  'age',
];

export function ClustersList() {
  const history = useHistory();
  // A custom (non-string) title disables ResourceListView's automatic SectionFilterHeader, so
  // the header is composed manually here: SectionFilterHeader keeps the "Namespace [ All
  // namespaces ]" control, and the summary strip below it sits above the table (ResourceListView
  // renders `children` underneath the table, so the strip can't go there).
  return (
    <ResourceListView
      title={
        <>
          <SectionFilterHeader
            title="Clusters"
            titleSideActions={[]}
            actions={[
              <AuthDisabledButton
                key="create-cluster"
                item={Cluster}
                authVerb="create"
                deniedMessage="You don't have permission to create Clusters."
              >
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => history.push(getClusterCreateUrl())}
                >
                  + Create Cluster
                </Button>
              </AuthDisabledButton>,
              <RestoreMenu key="restore-cluster" />,
            ]}
          />
          <Box sx={{ px: 2 }}>
            <ClusterSummaryBar />
          </Box>
        </>
      }
      resourceClass={Cluster}
      id="cnpg-clusters"
      columns={clusterColumns}
    />
  );
}
