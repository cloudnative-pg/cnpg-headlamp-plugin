import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  ConditionsTable,
  DetailsGrid,
  NameValueTable,
  ResourceLink,
  SectionBox,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { formatDuration, localeDate } from '@kinvolk/headlamp-plugin/lib/Utils';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ReactNode, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Cluster } from '../../resources/cluster';
import { FailoverQuorum } from '../../resources/failoverQuorum';
import { Pooler } from '../../resources/pooler';
import { Pod, PodPhaseLabel, PodStatusLabel } from '../common/podActions';
import { ViewLogsButton } from '../common/podLogs';
import { OpenTerminalButton } from '../common/podTerminal';
import {
  CHECKPOINTING,
  CNPG_REPLICATION,
  GENERAL_HEALTH,
  groupMetricsByCategory,
  POSTGRES_METRICS,
  PostgresMetric,
} from '../common/postgresMetrics';
import {
  extensionsWithUpdate,
  formatBytes,
  groupSeriesByLabel,
  PodMetricsResult,
  PrometheusSeries,
  scalarMetric,
  sumMetric,
  usePodMetrics,
} from '../common/promScrape';
import { PoolerStatusLabel } from '../poolers/List';
import { launchConnectActivity } from './connect';
import { SwitchoverAction } from './switchover';

const { createRouteURL } = Router;

type Pvc = InstanceType<typeof K8s.ResourceClasses.PersistentVolumeClaim>;

function sortByName<T extends { getName(): string }>(items: T[] | null | undefined): T[] {
  return [...(items ?? [])].sort((a, b) => a.getName().localeCompare(b.getName()));
}

function InstanceActions({ cluster, pod }: { cluster: Cluster; pod: Pod }) {
  return (
    <>
      <ViewLogsButton pod={pod} />
      <OpenTerminalButton pod={pod} />
      {pod.getName() !== cluster.currentPrimary && !cluster.isSwitchoverInProgress && (
        <SwitchoverAction cluster={cluster} pod={pod} />
      )}
    </>
  );
}

// Bootstrap job pods (initdb/join/full-recovery/...) don't have a running container to exec
// into once complete, so only logs make sense here — no terminal action.
function JobActions({ pod }: { pod: Pod }) {
  return <ViewLogsButton pod={pod} />;
}

function InstanceRoleLabel({ pod }: { pod: Pod }) {
  const role = pod.metadata.labels?.['cnpg.io/instanceRole'] ?? '-';
  const isReady = pod.status.containerStatuses?.every(container => container.ready) ?? false;

  if (!isReady) {
    return <StatusLabel status="error">{role} (not ready)</StatusLabel>;
  }
  switch (role) {
    case 'primary':
      return <StatusLabel status="success">primary</StatusLabel>;
    case 'replica':
      return <StatusLabel status="">replica</StatusLabel>;
    case 'unhealthy':
      return <StatusLabel status="error">unhealthy</StatusLabel>;
    default:
      return <>{role}</>;
  }
}

function InstancesSection({ cluster }: { cluster: Cluster }) {
  // cnpg.io/podRole=instance excludes the transient initdb/join/full-recovery bootstrap job pods
  // (see JobsSection), which also carry the cnpg.io/cluster label but aren't instances.
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });

  return (
    <SectionBox title="Instances">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pod: Pod) => <ResourceLink resource={pod} />,
          },
          {
            label: 'Role',
            getter: (pod: Pod) => <InstanceRoleLabel pod={pod} />,
          },
          {
            label: 'Status',
            getter: (pod: Pod) => <PodStatusLabel pod={pod} />,
          },
          {
            label: 'Timeline',
            getter: (pod: Pod) =>
              cluster.getInstanceReportedState(pod.getName())?.timeLineID ?? '-',
          },
          {
            label: 'Node',
            getter: (pod: Pod) => pod.spec.nodeName,
          },
          {
            label: 'QoS',
            getter: (pod: Pod) => pod.status.qosClass ?? '-',
          },
          {
            label: 'Actions',
            getter: (pod: Pod) => <InstanceActions cluster={cluster} pod={pod} />,
          },
        ]}
        data={sortByName(pods)}
      />
    </SectionBox>
  );
}

function MetricTile({ result, metric }: { result: PodMetricsResult; metric: PostgresMetric }) {
  const value = result.series ? metric.compute(result.series) : '';

  return (
    <Box
      sx={{
        position: 'relative',
        width: 140,
        height: 140,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        p: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        textAlign: 'center',
      }}
    >
      <Tooltip
        title={
          <Box sx={{ maxWidth: 240 }}>
            <Typography variant="caption" sx={{ display: 'block' }}>
              {metric.description}
            </Typography>
            <Box
              component="pre"
              sx={{ m: 0, mt: 1, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}
            >
              [{metric.metricNames.join(', ')}]
            </Box>
          </Box>
        }
      >
        <span style={{ position: 'absolute', top: 4, right: 4, display: 'flex' }}>
          <Icon icon="mdi:information-outline" width={14} height={14} />
        </span>
      </Tooltip>
      {result.loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : result.error ? (
        <Tooltip title={result.error}>
          <span>
            <StatusLabel status="error">Error</StatusLabel>
          </span>
        </Tooltip>
      ) : (
        <Typography variant="h6" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
          {value || '0'}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {metric.label}
        {metric.primaryOnly && ' (primary)'}
      </Typography>
    </Box>
  );
}

function MetricAccordion({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Accordion
      variant="outlined"
      defaultExpanded
      disableGutters
      sx={{ mb: 2, '&:last-child': { mb: 0 }, borderRadius: 1, '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
          {subtitle && (
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              sx={{ ml: 1, fontWeight: 400 }}
            >
              ({subtitle})
            </Typography>
          )}
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

function MetricTileGrid({
  metrics,
  result,
}: {
  metrics: [string, PostgresMetric][];
  result: PodMetricsResult;
}) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {metrics.map(([id, metric]) => (
        <MetricTile key={id} result={result} metric={metric} />
      ))}
    </Box>
  );
}

function StandbysTable({ series }: { series: PrometheusSeries | null }) {
  const rows = series
    ? [
        ...groupSeriesByLabel(
          series,
          [
            'cnpg_pg_stat_replication_write_diff_bytes',
            'cnpg_pg_stat_replication_flush_diff_bytes',
            'cnpg_pg_stat_replication_replay_diff_bytes',
            'cnpg_pg_stat_replication_backend_start',
          ],
          'application_name'
        ).entries(),
      ]
    : [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Standby', getter: ([name]: [string, unknown]) => name },
        {
          label: 'Write Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_stat_replication_write_diff_bytes'] ?? 0),
        },
        {
          label: 'Flush Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_stat_replication_flush_diff_bytes'] ?? 0),
        },
        {
          label: 'Replay Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_stat_replication_replay_diff_bytes'] ?? 0),
        },
        {
          label: 'Connected For',
          getter: ([, row]: [string, { values: Record<string, number> }]) => {
            const start = row.values['cnpg_pg_stat_replication_backend_start'];
            return start ? formatDuration(Date.now() - start * 1000, { format: 'brief' }) : '-';
          },
        },
      ]}
      data={rows}
    />
  );
}

function ReplicationSlotsTable({ series }: { series: PrometheusSeries | null }) {
  const rows = series
    ? [
        ...groupSeriesByLabel(
          series,
          ['cnpg_pg_replication_slots_active', 'cnpg_pg_replication_slots_pg_wal_lsn_diff'],
          'slot_name'
        ).entries(),
      ]
    : [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Slot Name', getter: ([name]: [string, unknown]) => name },
        {
          label: 'Type',
          getter: ([, row]: [string, { labels: Record<string, string> }]) =>
            row.labels.slot_type ?? '-',
        },
        {
          label: 'Active',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            row.values['cnpg_pg_replication_slots_active'] ? 'Yes' : 'No',
        },
        {
          label: 'Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_replication_slots_pg_wal_lsn_diff'] ?? 0),
        },
      ]}
      data={rows}
    />
  );
}

// datname="" is an aggregate/shared-catalog row, not a real database; template0 is frozen and
// never connectable — neither belongs in a per-database table.
const NON_DATABASE_DATNAMES = new Set(['', 'template0']);

function DatabaseHealthTable({ series }: { series: PrometheusSeries | null }) {
  const rows = series
    ? [...groupSeriesByLabel(
        series,
        [
          'cnpg_pg_database_xid_age',
          'cnpg_pg_database_mxid_age',
          'cnpg_pg_stat_database_xact_commit',
          'cnpg_pg_stat_database_xact_rollback',
          'cnpg_pg_stat_database_temp_files',
          'cnpg_pg_stat_database_temp_bytes',
        ],
        'datname'
      ).entries()].filter(([name]) => !NON_DATABASE_DATNAMES.has(name))
    : [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Database', getter: ([name]: [string, unknown]) => name },
        {
          label: 'Transaction ID Age',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            String(row.values['cnpg_pg_database_xid_age'] ?? 0),
        },
        {
          label: 'Multixact ID Age',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            String(row.values['cnpg_pg_database_mxid_age'] ?? 0),
        },
        {
          label: 'Rollback Ratio (%)',
          getter: ([, row]: [string, { values: Record<string, number> }]) => {
            const commit = row.values['cnpg_pg_stat_database_xact_commit'] ?? 0;
            const rollback = row.values['cnpg_pg_stat_database_xact_rollback'] ?? 0;
            return commit + rollback === 0 ? '0' : ((rollback * 100) / (commit + rollback)).toFixed(2);
          },
        },
        {
          label: 'Temp File Spill',
          getter: ([, row]: [string, { values: Record<string, number> }]) => {
            const files = row.values['cnpg_pg_stat_database_temp_files'] ?? 0;
            const bytes = row.values['cnpg_pg_stat_database_temp_bytes'] ?? 0;
            return files === 0 ? '0 files' : `${files} files (${formatBytes(bytes)})`;
          },
        },
        {
          label: 'Extension Updates',
          getter: ([name]: [string, unknown]) => {
            const extensions = extensionsWithUpdate(series!, name);
            return extensions.length === 0 ? 'Up to date' : extensions.join(', ');
          },
        },
      ]}
      data={rows}
    />
  );
}

function StatusStrip({ series }: { series: PrometheusSeries | null }) {
  if (!series) {
    return null;
  }

  const nodesUsed = scalarMetric(series, 'cnpg_collector_nodes_used');
  const fenced = scalarMetric(series, 'cnpg_collector_fencing_on') === 1;
  const switchoverRequired = scalarMetric(series, 'cnpg_collector_manual_switchover_required') === 1;
  const extensionUpdates = sumMetric(series, 'cnpg_pg_extensions_update_available');

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 2 }}>
      {nodesUsed > 0 && (
        <Typography variant="caption" color="text.secondary">
          Instances spread across {nodesUsed} node{nodesUsed === 1 ? '' : 's'}
        </Typography>
      )}
      {fenced && <Chip size="small" color="error" label="Instance Fenced" />}
      {switchoverRequired && (
        <Chip size="small" color="warning" label="Manual Switchover Required" />
      )}
      {extensionUpdates > 0 && (
        <Chip
          size="small"
          color="info"
          label={`${extensionUpdates} extension update${extensionUpdates === 1 ? '' : 's'} available`}
        />
      )}
    </Box>
  );
}

function MetricsSection({ cluster }: { cluster: Cluster }) {
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });
  const [selectedInstance, setSelectedInstance] = useState(cluster.currentPrimary ?? '');
  const [refreshSeconds, setRefreshSeconds] = useState(0);

  const primaryPod = pods?.find(pod => pod.getName() === cluster.currentPrimary) ?? null;
  const selectedPod = pods?.find(pod => pod.getName() === selectedInstance) ?? primaryPod;

  // Hooks must run unconditionally, before the currentPrimary bootstrapping check below.
  const primaryResult = usePodMetrics(primaryPod, refreshSeconds);
  const selectedIsPrimary = selectedPod?.getName() === primaryPod?.getName();
  const selectedResultOwn = usePodMetrics(selectedIsPrimary ? null : selectedPod, refreshSeconds);
  const selectedResult = selectedIsPrimary ? primaryResult : selectedResultOwn;

  if (!cluster.currentPrimary) {
    return null;
  }

  const instanceOptions = sortByName(pods).sort((a, b) =>
    a.getName() === cluster.currentPrimary ? -1 : b.getName() === cluster.currentPrimary ? 1 : 0
  );
  const metricsByCategory = new Map(groupMetricsByCategory(POSTGRES_METRICS));

  const selectedSubtitle = selectedPod
    ? `${selectedPod.getName()} - ${selectedPod.metadata.labels?.['cnpg.io/instanceRole'] ?? '-'}`
    : undefined;

  return (
    <SectionBox
      title="Live Metrics"
      headerProps={{
        actions: [
          <Select
            key="refresh-interval"
            size="small"
            value={refreshSeconds}
            onChange={e => setRefreshSeconds(Number(e.target.value))}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value={0}>Auto refresh: Off</MenuItem>
            <MenuItem value={15}>Refresh every 15s</MenuItem>
            <MenuItem value={30}>Refresh every 30s</MenuItem>
            <MenuItem value={60}>Refresh every 60s</MenuItem>
          </Select>,
        ],
      }}
    >
      <StatusStrip series={primaryResult.series} />

      <MetricAccordion title={CNPG_REPLICATION}>
        <MetricTileGrid metrics={metricsByCategory.get(CNPG_REPLICATION) ?? []} result={primaryResult} />
        <StandbysTable series={primaryResult.series} />
        <ReplicationSlotsTable series={primaryResult.series} />
      </MetricAccordion>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Select
          size="small"
          value={selectedInstance}
          onChange={e => setSelectedInstance(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          {instanceOptions.map(pod => (
            <MenuItem key={pod.getName()} value={pod.getName()}>
              {pod.getName()} ({pod.metadata.labels?.['cnpg.io/instanceRole'] ?? '-'})
            </MenuItem>
          ))}
        </Select>
      </Box>

      <MetricAccordion title={GENERAL_HEALTH} subtitle={selectedSubtitle}>
        <MetricTileGrid metrics={metricsByCategory.get(GENERAL_HEALTH) ?? []} result={selectedResult} />
      </MetricAccordion>

      <MetricAccordion title={CHECKPOINTING} subtitle={selectedSubtitle}>
        <MetricTileGrid metrics={metricsByCategory.get(CHECKPOINTING) ?? []} result={selectedResult} />
      </MetricAccordion>

      <MetricAccordion title="Database Health" subtitle={selectedSubtitle}>
        <DatabaseHealthTable series={selectedResult.series} />
      </MetricAccordion>
    </SectionBox>
  );
}

function JobsSection({ cluster }: { cluster: Cluster }) {
  // cnpg.io/jobRole (initdb, join, full-recovery, ...) identifies the transient bootstrap job
  // pods CNPG creates alongside instances — they carry cnpg.io/cluster too but not podRole.
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/jobRole`,
  });

  // Hide the section once we know there are no bootstrap jobs, rather than showing an empty
  // table — but keep rendering (with a loading state) while pods is still null.
  if (pods && pods.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Jobs">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pod: Pod) => <ResourceLink resource={pod} />,
          },
          {
            label: 'Job Role',
            getter: (pod: Pod) => pod.metadata.labels?.['cnpg.io/jobRole'] ?? '-',
          },
          {
            label: 'Phase',
            getter: (pod: Pod) => <PodPhaseLabel pod={pod} />,
          },
          {
            label: 'Node',
            getter: (pod: Pod) => pod.spec.nodeName,
          },
          {
            label: 'Actions',
            getter: (pod: Pod) => <JobActions pod={pod} />,
          },
        ]}
        data={sortByName(pods)}
        emptyMessage="No bootstrap jobs running"
      />
    </SectionBox>
  );
}

function PvcPhaseLabel({ pvc }: { pvc: Pvc }) {
  const phase = pvc.status?.phase;
  switch (phase) {
    case 'Bound':
      return <StatusLabel status="success">{phase}</StatusLabel>;
    case 'Lost':
      return <StatusLabel status="error">{phase}</StatusLabel>;
    case 'Pending':
      return <StatusLabel status="warning">{phase}</StatusLabel>;
    default:
      return <StatusLabel status="">{phase}</StatusLabel>;
  }
}

function PvcsSection({ cluster }: { cluster: Cluster }) {
  // Every instance can have more than one PVC (PG_DATA, PG_WAL, and optionally per-tablespace
  // volumes), each labeled with which instance and role it belongs to.
  const [pvcs] = K8s.ResourceClasses.PersistentVolumeClaim.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()}`,
  });

  return (
    <SectionBox title="Storage">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pvc: Pvc) => <ResourceLink resource={pvc} />,
          },
          {
            label: 'Instance',
            getter: (pvc: Pvc) => pvc.metadata.labels?.['cnpg.io/instanceName'] ?? '-',
          },
          {
            label: 'Role',
            getter: (pvc: Pvc) => pvc.metadata.labels?.['cnpg.io/pvcRole'] ?? '-',
          },
          {
            label: 'Status',
            getter: (pvc: Pvc) => <PvcPhaseLabel pvc={pvc} />,
          },
          {
            label: 'Capacity',
            getter: (pvc: Pvc) =>
              pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage ?? '-',
          },
          {
            label: 'Storage Class',
            getter: (pvc: Pvc) => pvc.spec?.storageClassName ?? '-',
          },
        ]}
        data={sortByName(pvcs)}
      />
    </SectionBox>
  );
}

function PoolersSection({ cluster }: { cluster: Cluster }) {
  // Poolers reference their cluster by spec.cluster.name rather than a label, so we fetch
  // every Pooler in the namespace and filter client-side instead of using a labelSelector.
  const [allPoolers] = Pooler.useList({ namespace: cluster.getNamespace() });
  const poolers = allPoolers?.filter(pooler => pooler.clusterName === cluster.getName());

  if (poolers && poolers.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Poolers">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            // ResourceLink defaults its route lookup to resource.kind ('Pooler'), but our route
            // is registered as 'CNPG Pooler' (see index.tsx) to dodge a naming collision —
            // so the default lookup fails silently and needs this explicit override. Pod/PVC
            // links elsewhere in this file don't need it since those are core Headlamp types
            // whose routes are already registered under their bare kind name.
            getter: (pooler: Pooler) => <ResourceLink resource={pooler} routeName="CNPG Pooler" />,
          },
          {
            label: 'Type',
            getter: (pooler: Pooler) => pooler.type,
          },
          {
            label: 'Pool Mode',
            getter: (pooler: Pooler) => pooler.poolMode ?? '-',
          },
          {
            label: 'Instances',
            getter: (pooler: Pooler) => pooler.instances,
          },
          {
            label: 'Status',
            getter: (pooler: Pooler) => <PoolerStatusLabel pooler={pooler} />,
          },
        ]}
        data={sortByName(poolers)}
      />
    </SectionBox>
  );
}

function FailoverQuorumSection({ cluster }: { cluster: Cluster }) {
  // CNPG maintains at most one FailoverQuorum per Cluster, in the same namespace and under the
  // same name, and deletes it as soon as quorum-based failover is switched off. So a 404 here is
  // the ordinary "not enabled" case, not an error worth showing — render nothing rather than
  // putting an empty section on every cluster page.
  const [quorum] = FailoverQuorum.useGet(cluster.getName(), cluster.getNamespace(), {
    cluster: cluster.cluster,
  });

  if (!quorum) {
    return null;
  }

  const standbyNames = quorum.standbyNames;

  return (
    <SectionBox title="Failover Quorum">
      <NameValueTable
        rows={[
          {
            name: 'Method',
            value: quorum.method ?? '-',
          },
          {
            name: 'Sync Standbys Required',
            value: quorum.standbyNumber ?? '-',
          },
          {
            name: 'Reporting Primary',
            value: quorum.primary ?? '-',
          },
          {
            name: 'Candidate Standbys',
            value: standbyNames.length > 0 ? standbyNames.join(', ') : '-',
          },
        ]}
      />
    </SectionBox>
  );
}

type Lease = InstanceType<typeof K8s.ResourceClasses.Lease>;

// CNPG maintains exactly one Lease per Cluster, same name and namespace, used for leader election
// among instances — so a missing Lease (e.g. right after cluster creation) is a transient,
// ordinary state, not an error worth showing (renders as '-' rather than nothing).
function leaseValue(lease: Lease | null) {
  if (!lease) {
    return '-';
  }

  // The API also sets spec.acquireTime, which the SDK's LeaseSpec type omits.
  const spec = lease.spec as typeof lease.spec & { acquireTime?: string };

  return (
    <Tooltip
      title={
        <>
          Acquired: {spec.acquireTime ? localeDate(spec.acquireTime) : '-'}
          <br />
          Duration: {spec.leaseDurationSeconds}s<br />
          Transitions: {spec.leaseTransitions}
        </>
      }
    >
      <span>
        {spec.holderIdentity
          ? `${spec.holderIdentity} (renewed ${
              spec.renewTime ? localeDate(spec.renewTime) : '-'
            })`
          : '-'}
      </span>
    </Tooltip>
  );
}

export function ClusterDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();
  const history = useHistory();
  const selectedCluster = K8s.useCluster();
  const [lease] = K8s.ResourceClasses.Lease.useGet(name, namespace, {
    cluster: selectedCluster ?? undefined,
  });

  return (
    <DetailsGrid
      resourceType={Cluster}
      name={name}
      namespace={namespace}
      withEvents
      actions={item =>
        item && [
          <ActionButton
            key="connect"
            description="Connect"
            icon="mdi:power-plug-outline"
            onClick={() => launchConnectActivity(item)}
          />,
          <ActionButton
            key="view-databases"
            description="View Databases"
            icon="mdi:database-outline"
            onClick={() =>
              history.push(
                `${createRouteURL(
                  'CNPG Databases'
                )}?cluster=${item.getName()}&namespace=${item.getNamespace()}`
              )
            }
          />,
          <ActionButton
            key="view-databaseroles"
            description="View Roles"
            icon="mdi:account-key-outline"
            onClick={() =>
              history.push(
                `${createRouteURL(
                  'CNPG Database Roles'
                )}?cluster=${item.getName()}&namespace=${item.getNamespace()}`
              )
            }
          />,
          <ActionButton
            key="view-backups"
            description="View Backups"
            icon="mdi:backup-restore"
            onClick={() =>
              history.push(
                `${createRouteURL(
                  'CNPG Backups'
                )}?cluster=${item.getName()}&namespace=${item.getNamespace()}`
              )
            }
          />,
          <ActionButton
            key="view-scheduled-backups"
            description="View Scheduled Backups"
            icon="mdi:calendar-clock"
            onClick={() =>
              history.push(
                `${createRouteURL(
                  'CNPG Scheduled Backups'
                )}?cluster=${item.getName()}&namespace=${item.getNamespace()}`
              )
            }
          />,
          <ActionButton
            key="view-publications"
            description="View Publications"
            icon="mdi:upload-network-outline"
            onClick={() =>
              history.push(
                `${createRouteURL(
                  'CNPG Publications'
                )}?cluster=${item.getName()}&namespace=${item.getNamespace()}`
              )
            }
          />,
          <ActionButton
            key="view-subscriptions"
            description="View Subscriptions"
            icon="mdi:download-network-outline"
            onClick={() =>
              history.push(
                `${createRouteURL(
                  'CNPG Subscriptions'
                )}?cluster=${item.getName()}&namespace=${item.getNamespace()}`
              )
            }
          />,
        ]
      }
      extraInfo={item =>
        item && [
          {
            name: 'Health',
            value: (
              <Tooltip title={item.phase ?? ''}>
                <StatusLabel status={item.health}>{item.healthLabel}</StatusLabel>
              </Tooltip>
            ),
          },
          {
            name: 'Primary',
            value: item.primaryLabel,
          },
          {
            name: 'Lease',
            value: leaseValue(lease),
          },
          {
            name: 'Instances',
            value: `${item.readyInstances} ready / ${item.instances} total`,
          },
          {
            name: 'PostgreSQL Image',
            value: item.image,
          },
          {
            name: 'Synchronous Replication',
            value:
              item.instances > 1 && !item.hasSynchronousReplication ? (
                <StatusLabel status="warning">
                  Off — multiple instances without synchronous replication risk data loss on
                  failover
                </StatusLabel>
              ) : item.hasSynchronousReplication ? (
                <StatusLabel status="success">
                  On ({item.syncReplicasRequired} required)
                </StatusLabel>
              ) : (
                'N/A (single instance)'
              ),
          },
        ]
      }
      extraSections={item =>
        item && [
          {
            id: 'instances',
            section: <InstancesSection cluster={item} />,
          },
          {
            id: 'metrics',
            section: <MetricsSection cluster={item} />,
          },
          {
            id: 'jobs',
            section: <JobsSection cluster={item} />,
          },
          {
            id: 'storage',
            section: <PvcsSection cluster={item} />,
          },
          {
            id: 'poolers',
            section: <PoolersSection cluster={item} />,
          },
          {
            id: 'failoverQuorum',
            section: <FailoverQuorumSection cluster={item} />,
          },
          {
            id: 'conditions',
            section: (
              <SectionBox title="Conditions">
                <ConditionsTable resource={item.jsonData} />
              </SectionBox>
            ),
          },
        ]
      }
    />
  );
}
