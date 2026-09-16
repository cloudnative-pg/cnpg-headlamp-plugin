export interface PostgresMetric {
  label: string;
  category: string;
  database: string;
  query: string;
  // Always reads the primary, ignoring the instance selector (replication topology, WAL
  // archiving mean nothing on a replica).
  primaryOnly?: boolean;
}

// Exported for Detail.tsx to attach the instance dropdown to this category's heading only.
export const GENERAL_HEALTH = 'General Health';
const CNPG_REPLICATION = 'CNPG Replication & Archiving';

// Future scope: let a user add their own entries here at runtime (e.g. persisted to a
// ConfigMap in the cluster, so they're shared across anyone using this plugin against it),
// rather than only this fixed, built-in set.
export const POSTGRES_METRICS: Record<string, PostgresMetric> = {
  connectedStandbys: {
    label: 'Connected Standbys',
    category: CNPG_REPLICATION,
    database: 'postgres',
    query: `SELECT count(*)
FROM pg_stat_replication;`,
    primaryOnly: true,
  },
  replicationLag: {
    label: 'Replication Lag (Max)',
    category: CNPG_REPLICATION,
    database: 'postgres',
    query: `SELECT pg_size_pretty(
  coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)), 0)
)
FROM pg_stat_replication;`,
    primaryOnly: true,
  },
  inactiveReplicationSlots: {
    label: 'Inactive Replication Slots',
    category: CNPG_REPLICATION,
    database: 'postgres',
    // A slot left behind by a dropped replica retains WAL indefinitely.
    query: `SELECT count(*)
FROM pg_replication_slots
WHERE NOT active;`,
    primaryOnly: true,
  },
  walArchivingFailures: {
    label: 'WAL Archiving Failures',
    category: CNPG_REPLICATION,
    database: 'postgres',
    query: `SELECT failed_count
FROM pg_stat_archiver;`,
    primaryOnly: true,
  },

  activeConnections: {
    label: 'Active Connections',
    category: GENERAL_HEALTH,
    database: 'postgres',
    // Excludes autovacuum/walsender/background workers, not just client sessions.
    query: `SELECT count(*)
FROM pg_stat_activity
WHERE backend_type = 'client backend';`,
  },
  cacheHitRatio: {
    label: 'Cache Hit Ratio (%)',
    category: GENERAL_HEALTH,
    database: 'postgres',
    query: `SELECT round(
  sum(blks_hit) * 100.0 / nullif(sum(blks_hit + blks_read), 0),
  2
)
FROM pg_stat_database;`,
  },
  totalDatabaseSize: {
    label: 'Total Database Size',
    category: GENERAL_HEALTH,
    database: 'postgres',
    query: `SELECT pg_size_pretty(sum(pg_database_size(datname)))
FROM pg_database;`,
  },
  blockedQueries: {
    label: 'Blocked Queries',
    category: GENERAL_HEALTH,
    database: 'postgres',
    query: `SELECT count(*)
FROM pg_stat_activity
WHERE wait_event_type = 'Lock';`,
  },
  deadlocks: {
    label: 'Deadlocks (Cumulative)',
    category: GENERAL_HEALTH,
    database: 'postgres',
    query: `SELECT coalesce(sum(deadlocks), 0)
FROM pg_stat_database;`,
  },
};

// Preserves each category's first-seen order in POSTGRES_METRICS.
export function groupMetricsByCategory(
  metrics: Record<string, PostgresMetric>
): [string, [string, PostgresMetric][]][] {
  const order: string[] = [];
  const groups: Record<string, [string, PostgresMetric][]> = {};

  for (const entry of Object.entries(metrics)) {
    const [, metric] = entry;
    if (!groups[metric.category]) {
      groups[metric.category] = [];
      order.push(metric.category);
    }
    groups[metric.category].push(entry);
  }

  return order.map(category => [category, groups[category]]);
}
