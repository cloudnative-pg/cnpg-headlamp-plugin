import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import {
  bucketCounts,
  bucketize,
  halfTrend,
  isClientConnection,
  isErrorOrFatal,
  isLockWait,
  isSlowStatement,
  PostgresLogEntry,
  Trend,
} from '../../../resources/postgresLog';
import { InstanceChip } from './InstanceChip';
import {
  formatClock,
  formatCount,
  formatSpan,
  LogColors,
  roleColor,
  useLogColors,
} from './logTheme';

const BUCKETS = 60;

export interface LogWindow {
  from: number;
  to: number;
}

export interface InstanceInfo {
  name: string;
  role: 'primary' | 'replica';
}

function Sparkline({ series, color }: { series: number[]; color: string }) {
  const width = 120;
  const height = 34;
  const max = Math.max(...series, 1);
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const points = series.map(
    (value, i) =>
      `${(i * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`
  );
  const line = points.join(' ');
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={color} opacity={0.14} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TrendLabel({ trend, increaseIsBad }: { trend: Trend; increaseIsBad: boolean }) {
  const colors = useLogColors();
  const { first, second, percent } = trend;
  if (first === 0 && second === 0) {
    return null;
  }
  const rising = second > first;
  const falling = second < first;
  const text =
    percent === null
      ? 'new'
      : `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(Math.round(percent))}%`;
  const color =
    increaseIsBad && rising
      ? colors.error
      : increaseIsBad && falling
      ? colors.ok
      : 'text.secondary';
  return (
    <Tooltip
      title={`${formatCount(first)} in the first half of the window, ${formatCount(
        second
      )} in the second`}
    >
      <Typography
        component="span"
        variant="caption"
        sx={{ fontWeight: 600, color, whiteSpace: 'nowrap' }}
      >
        {rising ? '▲ ' : falling ? '▼ ' : ''}
        {text}
      </Typography>
    </Tooltip>
  );
}

function InsightTile({
  title,
  total,
  series,
  trend,
  statusColor,
  increaseIsBad,
  description,
}: {
  title: string;
  total: number;
  series: number[];
  trend: Trend;
  statusColor: string;
  increaseIsBad: boolean;
  description: string;
}) {
  return (
    <Tooltip title={description}>
      <Box
        role="group"
        aria-label={title}
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.5,
          height: '100%',
          position: 'relative',
        }}
      >
        <Box
          component="span"
          aria-hidden
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 8,
            height: 8,
            borderRadius: '2px',
            bgcolor: statusColor,
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.25 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {formatCount(total)}
          </Typography>
          <TrendLabel trend={trend} increaseIsBad={increaseIsBad} />
        </Box>
        <Box sx={{ mt: 1 }}>
          <Sparkline series={series} color={statusColor} />
        </Box>
      </Box>
    </Tooltip>
  );
}

export function InsightTiles({
  entries,
  window: { from, to },
  summary,
}: {
  entries: PostgresLogEntry[];
  window: LogWindow;
  summary: string;
}) {
  const colors = useLogColors();
  const tiles = useMemo(() => {
    const build = (predicate: (entry: PostgresLogEntry) => boolean) => {
      const series = bucketCounts(entries, from, to, BUCKETS, predicate);
      return {
        series,
        total: series.reduce((sum, value) => sum + value, 0),
        trend: halfTrend(series),
      };
    };
    return {
      connections: build(isClientConnection),
      slow: build(isSlowStatement),
      locks: build(isLockWait),
      errors: build(isErrorOrFatal),
    };
  }, [entries, from, to]);

  return (
    <SectionBox title="Insights" headerProps={{ titleSideActions: [] }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {summary}
      </Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <InsightTile
            title="Connections"
            description="Client sessions accepted (“connection authorized”). Requires log_connections."
            {...tiles.connections}
            statusColor={colors.ok}
            increaseIsBad={false}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <InsightTile
            title="Slow statements"
            description="Statements slower than log_min_duration_statement."
            {...tiles.slow}
            statusColor={tiles.slow.total > 0 ? colors.warning : colors.ok}
            increaseIsBad
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <InsightTile
            title="Lock waits"
            description="Sessions that waited longer than deadlock_timeout for a lock, plus detected deadlocks. Requires log_lock_waits."
            {...tiles.locks}
            statusColor={tiles.locks.total > 0 ? colors.warning : colors.ok}
            increaseIsBad
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <InsightTile
            title="Errors & fatals"
            description="Log entries with severity ERROR, FATAL or PANIC."
            {...tiles.errors}
            statusColor={tiles.errors.total > 0 ? colors.error : colors.ok}
            increaseIsBad
          />
        </Grid>
      </Grid>
    </SectionBox>
  );
}

function RoleBadge({ role }: { role: 'primary' | 'replica' }) {
  const colors = useLogColors();
  const color = roleColor(colors, role);
  return (
    <Box
      component="span"
      sx={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        px: 0.75,
        py: 0.1,
        borderRadius: 0.5,
        color,
        border: '1px solid',
        borderColor: color,
        flexShrink: 0,
      }}
    >
      {role}
    </Box>
  );
}

const ACTIVITY_COLUMNS = 'minmax(180px, 240px) 1fr 84px 64px';

function ActivityBars({
  entries,
  window: { from, to },
  max,
  coverageStart,
  colors,
}: {
  entries: PostgresLogEntry[];
  window: LogWindow;
  max: number;
  /** Earliest log line loaded for this pod; earlier buckets have no data, not zero. */
  coverageStart: number | undefined;
  colors: LogColors;
}) {
  const buckets = useMemo(() => bucketize(entries, from, to, BUCKETS), [entries, from, to]);
  const width = (to - from) / BUCKETS;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 32 }}>
      {buckets.map(bucket => {
        const range = `${formatClock(bucket.start)}–${formatClock(bucket.start + width)}`;
        if (bucket.total === 0) {
          const noData = coverageStart === undefined || bucket.start + width <= coverageStart;
          return (
            <Box
              key={bucket.start}
              title={`${range} · ${noData ? 'before the loaded logs begin' : 'no log lines'}`}
              sx={{
                flex: 1,
                minWidth: 2,
                height: '2px',
                bgcolor: 'divider',
                opacity: noData ? 0.35 : 1,
              }}
            />
          );
        }
        const parts = [`${formatCount(bucket.total)} lines`];
        if (bucket.errors > 0) {
          parts.push(`${formatCount(bucket.errors)} errors`);
        }
        if (bucket.warnings > 0) {
          parts.push(`${formatCount(bucket.warnings)} warnings`);
        }
        // Stacked by severity (errors on top) so warnings aren't hidden under errors; each slice
        // has a minimum height so a few warnings among hundreds of lines still show.
        const segments = [
          [bucket.errors, colors.error],
          [bucket.warnings, colors.warning],
          [bucket.total - bucket.errors - bucket.warnings, colors.ok],
        ].filter(([count]) => (count as number) > 0) as [number, string][];
        return (
          <Box
            key={bucket.start}
            title={`${range} · ${parts.join(' · ')}`}
            sx={{
              flex: 1,
              minWidth: 2,
              height: `${Math.max(8, (bucket.total / max) * 100)}%`,
              // Room for a 3px slice per severity plus the 1px gaps.
              minHeight: segments.length * 4 - 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '1px',
              borderRadius: '2px 2px 0 0',
              overflow: 'hidden',
            }}
          >
            {segments.map(([count, color]) => (
              <Box key={color} sx={{ flex: count, minHeight: 3, bgcolor: color }} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

export function ActivityByInstance({
  entries,
  allEntries,
  instances,
  window,
}: {
  entries: PostgresLogEntry[];
  /** Entries regardless of window, to find where each pod's loaded logs begin. */
  allEntries: PostgresLogEntry[];
  instances: InstanceInfo[];
  window: LogWindow;
}) {
  const colors = useLogColors();
  const [roleFilter, setRoleFilter] = useState<'all' | 'primary' | 'replica'>('all');
  const { from, to } = window;
  const binWidth = (to - from) / BUCKETS;

  const rows = useMemo(
    () =>
      instances
        .filter(instance => roleFilter === 'all' || instance.role === roleFilter)
        .map(instance => {
          const own = entries.filter(entry => entry.pod === instance.name);
          return {
            ...instance,
            entries: own,
            errors: own.filter(isErrorOrFatal).length,
          };
        }),
    [instances, entries, roleFilter]
  );

  const coverage = useMemo(() => {
    const earliest = new Map<string, number>();
    for (const entry of allEntries) {
      const seen = earliest.get(entry.pod);
      if (seen === undefined || entry.time < seen) {
        earliest.set(entry.pod, entry.time);
      }
    }
    return earliest;
  }, [allEntries]);

  // One shared scale, so a quiet replica doesn't look as busy as the primary.
  const max = useMemo(() => {
    let peak = 1;
    for (const row of rows) {
      for (const bucket of bucketize(row.entries, from, to, BUCKETS)) {
        peak = Math.max(peak, bucket.total);
      }
    }
    return peak;
  }, [rows, from, to]);

  return (
    <SectionBox
      title="Activity by instance"
      headerProps={{
        titleSideActions: [],
        actions: [
          <ToggleButtonGroup
            key="role-filter"
            size="small"
            exclusive
            value={roleFilter}
            onChange={(_, value) => value && setRoleFilter(value)}
            aria-label="Show instances"
          >
            <ToggleButton value="all">All pods</ToggleButton>
            <ToggleButton value="primary">Primary</ToggleButton>
            <ToggleButton value="replica">Replica</ToggleButton>
          </ToggleButtonGroup>,
        ],
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Bar height = log volume per {formatSpan(binWidth)} bin, split by severity.
        </Typography>
        {[
          ['Normal', colors.ok],
          ['Warnings', colors.warning],
          ['Errors / fatals', colors.error],
        ].map(([label, color]) => (
          <Box key={label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="span"
              sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color }}
            />
            <Typography variant="caption">{label}</Typography>
          </Box>
        ))}
      </Box>

      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No instances match.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {rows.map(row => (
            <Box
              key={row.name}
              sx={{
                display: 'grid',
                gridTemplateColumns: ACTIVITY_COLUMNS,
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <InstanceChip name={row.name} role={row.role} colors={colors} />
                <RoleBadge role={row.role} />
              </Box>
              <ActivityBars
                entries={row.entries}
                window={window}
                max={max}
                coverageStart={coverage.get(row.name)}
                colors={colors}
              />
              <Typography variant="body2" sx={{ textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCount(row.entries.length)}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontWeight: row.errors > 0 ? 700 : 400,
                  color: row.errors > 0 ? colors.error : 'text.secondary',
                }}
              >
                {formatCount(row.errors)} err
              </Typography>
            </Box>
          ))}
          <Box sx={{ display: 'grid', gridTemplateColumns: ACTIVITY_COLUMNS, gap: 2 }} aria-hidden>
            <span />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                {formatClock(from)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatClock((from + to) / 2)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatClock(to)}
              </Typography>
            </Box>
            <span />
            <span />
          </Box>
        </Box>
      )}
    </SectionBox>
  );
}
