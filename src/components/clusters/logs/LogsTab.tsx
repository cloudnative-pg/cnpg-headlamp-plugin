import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { useDeferredValue, useMemo, useState } from 'react';
import { Cluster } from '../../../resources/cluster';
import {
  countByCategory,
  distinctSeverities,
  filterEntries,
  instanceContainers,
  LogCategory,
  POSTGRES_CONTAINER,
  PostgresLogEntry,
  sortEntries,
} from '../../../resources/postgresLog';
import { ActivityByInstance, InsightTiles, InstanceInfo, LogWindow } from './LogInsights';
import { LogStream } from './LogStream';
import { formatCount, formatLogTimestamp } from './logTheme';
import { useClusterPostgresLogs } from './useClusterPostgresLogs';

type RangeKey = '15m' | '1h' | '6h' | '24h' | 'all';

const RANGES: { key: RangeKey; label: string; ms?: number }[] = [
  { key: '15m', label: 'Last 15 minutes', ms: 15 * 60_000 },
  { key: '1h', label: 'Last hour', ms: 60 * 60_000 },
  { key: '6h', label: 'Last 6 hours', ms: 6 * 60 * 60_000 },
  { key: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60_000 },
  { key: 'all', label: 'All loaded logs' },
];

// Most recent lines loaded from each instance when the streams open; newer ones keep streaming in.
const TAIL_LINES = 5000;

/**
 * The charted window. It never ends before the newest line, so a browser clock that runs behind
 * the cluster's can't hide fresh entries.
 */
function computeWindow(
  entries: PostgresLogEntry[],
  range: RangeKey,
  live: boolean,
  now: number
): LogWindow {
  let min = Infinity;
  let max = -Infinity;
  for (const entry of entries) {
    min = Math.min(min, entry.time);
    max = Math.max(max, entry.time);
  }
  const hasEntries = entries.length > 0;
  const to = hasEntries ? (live ? Math.max(now, max) : max) : now;
  const span = RANGES.find(r => r.key === range)?.ms;
  let from = span !== undefined ? to - span : hasEntries ? min : to - 60 * 60_000;
  if (to - from < 60_000) {
    from = to - 60_000;
  }
  return { from, to };
}

function downloadJsonl(rows: PostgresLogEntry[], filename: string) {
  const blob = new Blob([rows.map(row => row.raw).join('\n') + '\n'], {
    type: 'application/x-ndjson',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function LogsTab({ cluster }: { cluster: Cluster }) {
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });

  const [live, setLive] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedPods, setSelectedPods] = useState<string[]>([]);
  const [range, setRange] = useState<RangeKey>('all');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [sortDirection, setSortDirection] = useState<'newest' | 'oldest'>('newest');
  const [categories, setCategories] = useState<ReadonlySet<LogCategory>>(new Set());
  const [container, setContainer] = useState(POSTGRES_CONTAINER);

  // Like the per-pod log viewer: every container, init containers first. Falls back to postgres
  // if the chosen one goes away.
  const containers = useMemo(() => instanceContainers(pods ?? []), [pods]);
  const activeContainer = containers.includes(container) ? container : POSTGRES_CONTAINER;
  const isPostgres = activeContainer === POSTGRES_CONTAINER;

  const logs = useClusterPostgresLogs(pods, {
    live,
    tailLines: TAIL_LINES,
    reloadKey,
    container: activeContainer,
  });
  const deferredSearch = useDeferredValue(search);

  const instances = useMemo<InstanceInfo[]>(
    () =>
      [...(pods ?? [])]
        .map(pod => pod.getName())
        .sort((a, b) =>
          a === cluster.currentPrimary ? -1 : b === cluster.currentPrimary ? 1 : a.localeCompare(b)
        )
        .map(name => ({
          name,
          role: name === cluster.currentPrimary ? ('primary' as const) : ('replica' as const),
        })),
    [pods, cluster.currentPrimary]
  );
  const roleByPod = useMemo(
    () => new Map(instances.map(instance => [instance.name, instance.role])),
    [instances]
  );

  // scope (window + instances) feeds the charts; + severity and search gives the chip counts;
  // + chip selection gives the rows.
  const now = useMemo(() => Date.now(), [logs.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const window = useMemo(
    () => computeWindow(logs.entries, range, live, now),
    [logs.entries, range, live, now]
  );
  const podSet = useMemo(() => new Set(selectedPods), [selectedPods]);
  const scoped = useMemo(
    () => filterEntries(logs.entries, { from: window.from, to: window.to, pods: podSet }),
    [logs.entries, window, podSet]
  );
  // Only the levels that exist, like the per-pod viewer; the chosen one is always kept.
  const severityOptions = useMemo(() => {
    const present = distinctSeverities(scoped);
    return severity && !present.includes(severity) ? [...present, severity] : present;
  }, [scoped, severity]);
  const streamBase = useMemo(
    () => filterEntries(scoped, { severity, search: deferredSearch }),
    [scoped, severity, deferredSearch]
  );
  const categoryCounts = useMemo(() => countByCategory(streamBase), [streamBase]);
  const rows = useMemo(
    () => sortEntries(filterEntries(streamBase, { categories }), sortDirection),
    [streamBase, categories, sortDirection]
  );

  const filtersActive =
    selectedPods.length > 0 || severity !== '' || search !== '' || categories.size > 0;
  const clearFilters = () => {
    setSelectedPods([]);
    setSeverity('');
    setSearch('');
    setCategories(new Set());
  };
  const resetKey = JSON.stringify([
    activeContainer,
    selectedPods,
    range,
    severity,
    deferredSearch,
    sortDirection,
    [...categories],
  ]);

  const toggleCategory = (category: LogCategory) =>
    setCategories(previous => {
      const next = new Set(previous);
      if (!next.delete(category)) {
        next.add(category);
      }
      return next;
    });

  const instanceCount = selectedPods.length > 0 ? selectedPods.length : instances.length;
  const rangeLabel =
    range === 'all'
      ? `All loaded logs (${formatLogTimestamp(window.from).slice(0, -4)} – ${formatLogTimestamp(
          window.to
        ).slice(0, -4)})`
      : RANGES.find(r => r.key === range)?.label ?? '';
  const summary = `${rangeLabel} · ${instanceCount} instance${
    instanceCount === 1 ? '' : 's'
  } · ${formatCount(scoped.length)} lines`;

  const loading = live && logs.received.length === 0 && logs.stopped.length < instances.length;
  let emptyMessage: string;
  if (logs.entries.length > 0) {
    emptyMessage = 'No log lines match the current filters.';
  } else if (loading || pods === null) {
    emptyMessage = `Loading logs from ${instances.length || 'the'} instance${
      instances.length === 1 ? '' : 's'
    }…`;
  } else if (logs.stopped.length > 0) {
    emptyMessage =
      'Could not read logs from any instance. Check that you have permission to read pod logs (pods/log) and that the pods are running.';
  } else if (!live) {
    emptyMessage = 'Logging is paused and nothing has been loaded yet. Press Live to start.';
  } else {
    emptyMessage = isPostgres
      ? `No PostgreSQL log records found in the last ${formatCount(
          TAIL_LINES
        )} lines of each instance.`
      : `No structured log lines found in the last ${formatCount(
          TAIL_LINES
        )} lines of ${activeContainer} on each instance.`;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        {containers.length > 1 && (
          <Select
            size="small"
            value={activeContainer}
            onChange={event => {
              setContainer(event.target.value);
              setSeverity('');
              setCategories(new Set());
            }}
            inputProps={{ 'aria-label': 'Container' }}
          >
            {containers.map(name => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
        )}
        <TextField
          size="small"
          placeholder={
            isPostgres
              ? 'Search message, query, user, database, session…'
              : 'Search message, logger and fields…'
          }
          value={search}
          onChange={event => setSearch(event.target.value)}
          sx={{ flex: '1 1 200px', minWidth: 160 }}
          inputProps={{ 'aria-label': 'Search logs' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon="mdi:magnify" width={18} height={18} />
              </InputAdornment>
            ),
          }}
        />
        <Select
          multiple
          displayEmpty
          size="small"
          value={selectedPods}
          onChange={event =>
            setSelectedPods(
              typeof event.target.value === 'string'
                ? event.target.value.split(',')
                : event.target.value
            )
          }
          renderValue={selected =>
            selected.length === 0
              ? 'All instances'
              : selected.length === 1
              ? selected[0]
              : `${selected.length} instances`
          }
          inputProps={{ 'aria-label': 'Instances' }}
          sx={{ minWidth: 170 }}
        >
          {instances.map(instance => (
            <MenuItem key={instance.name} value={instance.name}>
              <Checkbox size="small" checked={selectedPods.includes(instance.name)} />
              <ListItemText primary={instance.name} secondary={instance.role} />
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          displayEmpty
          value={severity}
          onChange={event => setSeverity(event.target.value)}
          inputProps={{ 'aria-label': 'Level' }}
        >
          <MenuItem value="">All levels</MenuItem>
          {severityOptions.map(level => (
            <MenuItem key={level} value={level}>
              {level}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={range}
          onChange={event => setRange(event.target.value as RangeKey)}
          inputProps={{ 'aria-label': 'Time range' }}
        >
          {RANGES.map(option => (
            <MenuItem key={option.key} value={option.key}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={sortDirection}
          onChange={event => setSortDirection(event.target.value as 'newest' | 'oldest')}
          inputProps={{ 'aria-label': 'Sort order' }}
        >
          <MenuItem value="newest">Newest first</MenuItem>
          <MenuItem value="oldest">Oldest first</MenuItem>
        </Select>
        <Button
          size="small"
          variant={live ? 'contained' : 'outlined'}
          onClick={() => setLive(value => !value)}
        >
          {live ? 'Live ●' : 'Paused'}
        </Button>
        <Tooltip title="Reload logs from the instances">
          <IconButton
            aria-label="Reload logs"
            onClick={() => {
              setReloadKey(key => key + 1);
              setLive(true);
            }}
          >
            <Icon icon="mdi:refresh" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Download the lines currently listed as JSON Lines">
          <span>
            <IconButton
              aria-label="Download logs"
              disabled={rows.length === 0}
              onClick={() =>
                downloadJsonl(rows, `${cluster.getName()}-${activeContainer}-logs.jsonl`)
              }
            >
              <Icon icon="mdi:download" />
            </IconButton>
          </span>
        </Tooltip>
        {filtersActive && (
          <Button size="small" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </Box>

      {logs.stopped.length > 0 && logs.entries.length > 0 && (
        <Alert severity="warning">
          No logs could be read from {logs.stopped.join(', ')}. Check that the pod is running and
          that you have permission to read pod logs.
        </Alert>
      )}

      {/* Postgres-only: the tiles count Postgres events. */}
      {isPostgres && <InsightTiles entries={scoped} window={window} summary={summary} />}
      <ActivityByInstance
        entries={scoped}
        allEntries={logs.entries}
        instances={instances.filter(
          instance => selectedPods.length === 0 || podSet.has(instance.name)
        )}
        window={window}
      />
      <LogStream
        rows={rows}
        categoryCounts={categoryCounts}
        selectedCategories={categories}
        onToggleCategory={toggleCategory}
        onShowCategory={category => {
          setCategories(new Set([category]));
          setSearch('');
        }}
        live={live}
        container={activeContainer}
        showCategories={isPostgres}
        roleByPod={roleByPod}
        resetKey={resetKey}
        emptyMessage={emptyMessage}
      />
    </Box>
  );
}
