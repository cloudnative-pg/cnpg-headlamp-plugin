import {
  ColumnType,
  Link,
  ResourceListView,
  ResourceTableColumn,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Cluster } from '../../resources/cluster';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { SummaryBar, SummaryStat, useNamespaceScope } from '../common/ListHeader';
import { StatusChip, StatusIcon } from '../common/SeverityStatus';
import { getClusterCreateUrl } from './create/CreatePage';
import { HibernateListAction } from './hibernate';

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
// "Needs attention" counts clusters whose phase is a warning or error — the per-row
// Status column below keeps the finer-grained label; backup problems show in the Backup column. Instance count is the desired
// spec.instances total, matching `kubectl get clusters` rather than live pod counts.
function ClusterSummaryBar() {
  // Counts follow Headlamp's namespace filter so they match the rows in the table below.
  const [allClusters] = Cluster.useList();
  const scope = useNamespaceScope(allClusters);
  const clusters = scope.items;

  const total = clusters.length;
  const healthy = clusters.filter(c => c.phaseStatus.severity === 'success').length;
  const hibernated = clusters.filter(c => c.isHibernated).length;
  const needsAttention = clusters.filter(c =>
    ['warning', 'error'].includes(c.phaseStatus.severity)
  ).length;
  const instances = clusters.reduce((sum, c) => sum + c.instances, 0);

  const stats: SummaryStat[] = [
    { value: total, label: total === 1 ? 'Cluster' : 'Clusters' },
    { value: healthy, label: 'Healthy' },
    { value: hibernated, label: 'Hibernated' },
    { value: needsAttention, label: 'Needs attention', highlight: needsAttention > 0 },
    { value: instances, label: 'Instances' },
  ];

  return <SummaryBar stats={stats} scope={{ ...scope, shown: total }} />;
}

const clusterColumns: (ResourceTableColumn<Cluster> | ColumnType)[] = [
  {
    id: 'cluster',
    label: 'Cluster',
    getValue: item => item.getName(),
    // A hibernated cluster has no detail page (no pods, no status to show), so its name
    // renders as plain text rather than a link — rehydration happens from this list.
    render: item =>
      item.isHibernated ? (
        <Tooltip title="Hibernated — detail view unavailable until rehydrated">
          <span>{item.getName()}</span>
        </Tooltip>
      ) : (
        <Link kubeObject={item} />
      ),
  },
  'namespace',
  {
    id: 'status',
    label: 'Status',
    getValue: item => item.phaseStatus.label,
    render: item => <StatusChip status={item.phaseStatus} />,
  },
  {
    id: 'backup',
    label: 'Backup',
    getValue: item => item.backupStatus?.label ?? '',
    // Clusters that report no backup condition (no backups configured) show nothing.
    render: item => (item.backupStatus ? <StatusIcon status={item.backupStatus} /> : null),
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
    label: 'Synchronous Replication',
    getValue: item => (item.hasSynchronousReplication ? 'Enabled' : 'Disabled'),
    render: item => (item.hasSynchronousReplication ? '✓ Enabled' : '— Disabled'),
  },
  'age',
];

// Hibernate/rehydrate toggle in the table's row-action menu (right side). Headlamp renders
// `actions` inside each row's "⋮" menu, so the toggle uses the menu button style there.
function clusterRowActions() {
  return [
    {
      id: 'cnpg-cluster-hibernate',
      action: ({ item, closeMenu }: { item: Cluster; closeMenu?: () => void }) => (
        <HibernateListAction cluster={item} closeMenu={closeMenu} />
      ),
    },
  ];
}

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
                  Create Cluster
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
      enableRowActions
      actions={clusterRowActions()}
    />
  );
}
