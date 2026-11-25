/**
 * Pure logic behind the cluster Logs tab: parsing pod logs into Postgres log events, classifying,
 * filtering and aggregating them. No React, so it is unit-tested (postgresLog.test.ts).
 *
 * Structured Postgres records (logger "postgres", msg "record": the csvlog columns CNPG relays as
 * JSON, see https://cloudnative-pg.io/docs/1.30/logging) are parsed into full entries. The
 * instance manager's own structured lines (any other logger) are kept too, as the "manager"
 * category. The plain-text stderr lines from before the logging collector starts, and the
 * plain-text duplicates of records, are left out; the per-pod log viewer shows those.
 */
import { formatLogValue, parseCnpgLogLines, ParsedLogLine, parseTimestamp } from './cnpgLog';

export const POSTGRES_CONTAINER = 'postgres';

export type LogCategory =
  | 'connections'
  | 'internal'
  | 'statements'
  | 'wal'
  | 'autovacuum'
  | 'constraints'
  | 'locks'
  | 'server'
  | 'standby'
  | 'errors'
  | 'manager'
  | 'other';

export const LOG_CATEGORIES: { id: LogCategory; label: string; description: string }[] = [
  {
    id: 'connections',
    label: 'Connections',
    description: 'Connection received/authorized, disconnections, failed logins, killed sessions',
  },
  {
    id: 'internal',
    label: 'Internal',
    description:
      'Connect and disconnect lines of CloudNativePG’s own local sessions (instance manager, readiness probe)',
  },
  {
    id: 'statements',
    label: 'Slow statements',
    description: 'Slow statements (log_min_duration_statement), logged statements, temp files',
  },
  { id: 'wal', label: 'WAL', description: 'Checkpoints, restartpoints and WAL activity' },
  { id: 'autovacuum', label: 'Autovacuum', description: 'Automatic vacuum and analyze runs' },
  {
    id: 'constraints',
    label: 'Constraints',
    description: 'Integrity violations: unique, foreign key, not-null, check (SQLSTATE 23xxx)',
  },
  {
    id: 'locks',
    label: 'Locks',
    description: 'Lock waits (log_lock_waits), lock timeouts and deadlocks',
  },
  {
    id: 'server',
    label: 'Server',
    description: 'Postmaster and startup events, configuration reloads and parameter changes',
  },
  {
    id: 'standby',
    label: 'Replica',
    description: 'Streaming replication: WAL sender/receiver, standby connections, recovery',
  },
  {
    id: 'errors',
    label: 'App errors',
    description: 'Any other ERROR, FATAL or PANIC: syntax errors, permission denied, timeouts, ...',
  },
  {
    id: 'manager',
    label: 'Instance manager',
    description:
      'Logs of the CloudNativePG instance manager running next to Postgres: reconciliation, failover, quorum, backups, ...',
  },
  { id: 'other', label: 'Other', description: 'Everything else, e.g. application warnings' },
];

export const LOG_CATEGORY_LABELS = Object.fromEntries(
  LOG_CATEGORIES.map(category => [category.id, category.label])
) as Record<LogCategory, string>;

export interface PostgresLogEntry {
  /** Unique and stable across refreshes; used as the React key. */
  key: string;
  pod: string;
  time: number;
  /** Upper-cased error_severity: DEBUG1-5, LOG, INFO, NOTICE, WARNING, ERROR, FATAL, PANIC. */
  severity: string;
  category: LogCategory;
  message: string;
  /** Logger of a line from a non-Postgres container. */
  logger?: string;
  pid: string;
  user?: string;
  database?: string;
  client?: string;
  applicationName?: string;
  backendType?: string;
  sqlState?: string;
  query?: string;
  detail?: string;
  hint?: string;
  context?: string;
  internalQuery?: string;
  /** Label/value pairs for the panel's "Parsed fields", in display order. */
  fields: [string, string][];
  raw: string;
  searchText: string;
}

export type SeverityGroup = 'debug' | 'log' | 'notice' | 'warning' | 'error' | 'fatal';

/** Orders severities from DEBUG (0) to PANIC (6). */
export function severityRank(severity: string): number {
  switch (severity) {
    case 'PANIC':
      return 6;
    case 'FATAL':
      return 5;
    case 'ERROR':
      return 4;
    case 'WARNING':
      return 3;
    case 'NOTICE':
      return 2;
    case 'LOG':
    case 'INFO':
      return 1;
    default:
      return 0; // DEBUG1..DEBUG5 and anything unknown
  }
}

export function severityGroup(severity: string): SeverityGroup {
  switch (severityRank(severity)) {
    case 6:
    case 5:
      return 'fatal';
    case 4:
      return 'error';
    case 3:
      return 'warning';
    case 2:
      return 'notice';
    case 1:
      return 'log';
    default:
      return 'debug';
  }
}

// Anchored on how Postgres words each event: messages and logged statements embed user text, so
// an unanchored /archive/ would tag `relation "archive_log" does not exist` as WAL.
const STANDBY_MESSAGE =
  /^(started streaming WAL|restarted WAL streaming|replication terminated|could not receive data from WAL stream|waiting for WAL to become available|standby ".*" is now|entering standby mode|consistent recovery state|redo (starts|done)|recovery (has paused|ended)|received promote request|selected new timeline|archive recovery complete|terminating walreceiver)/;
const STATEMENT_MESSAGE = /^(duration:|statement:|execute [^:]*:|temporary file)/;
const LOCK_MESSAGE =
  /^process \d+ (still waiting for|acquired \w+ on|detected deadlock)|^deadlock detected|due to lock timeout$/;
const CONNECTION_MESSAGE =
  /^(replication )?connection (received|authorized|authenticated)|^disconnection:|^terminating connection|^no pg_hba\.conf entry|^could not accept SSL|^[A-Za-z]+ authentication failed/;
// The lifecycle of a session that got in; failures and kills are never internal noise.
const SESSION_LIFECYCLE_MESSAGE = /^connection (received|authenticated|authorized)|^disconnection:/;
// Local-socket sessions opened by CloudNativePG itself: the instance manager, its metrics
// exporter and the readiness probe.
const LOCAL_CLIENT = '[local]';
const INTERNAL_APPLICATIONS: ReadonlySet<string> = new Set([
  'cnpg-instance-manager',
  'cnpg_metrics_exporter',
  'pg_isready',
]);
// FATAL only: at ERROR level the same wording comes from DDL in an established session
// (e.g. DROP DATABASE nope).
const CONNECTION_REJECTED_MESSAGE = /^(database|role) ".*" does not exist/;
const AUTOVACUUM_MESSAGE = /^automatic (aggressive )?(vacuum|analyze)/;
const WAL_MESSAGE =
  /^(checkpoint|restartpoint|recovery restart point|checkpoints are occurring|archive command|archiving write-ahead|could not archive|removing (WAL|write-ahead)|WAL )/;
const SERVER_MESSAGE =
  /^(received SIGHUP|parameter ".*" changed|(the )?database system|listening on|starting PostgreSQL|redirecting log|ending log|shutting down|aborting any active|background worker|worker process)/;

export function categorizeRecord(input: {
  message: string;
  severity: string;
  sqlState?: string;
  backendType?: string;
  user?: string;
  client?: string;
  applicationName?: string;
}): LogCategory {
  const {
    message,
    severity,
    sqlState = '',
    backendType = '',
    user = '',
    client = '',
    applicationName = '',
  } = input;
  const rank = severityRank(severity);

  // Strong signals first: who emitted the line says more than its wording.
  if (
    backendType === 'walsender' ||
    backendType === 'walreceiver' ||
    user === 'streaming_replica' ||
    STANDBY_MESSAGE.test(message)
  ) {
    return 'standby';
  }
  // Statement logs embed the SQL text, so nothing below may look inside them.
  if (STATEMENT_MESSAGE.test(message)) {
    return 'statements';
  }
  if (LOCK_MESSAGE.test(message) || sqlState === '40P01' || sqlState === '55P03') {
    return 'locks';
  }
  if (sqlState.startsWith('23')) {
    return 'constraints';
  }
  if (
    client === LOCAL_CLIENT &&
    INTERNAL_APPLICATIONS.has(applicationName) &&
    SESSION_LIFECYCLE_MESSAGE.test(message)
  ) {
    return 'internal';
  }
  if (
    CONNECTION_MESSAGE.test(message) ||
    (rank >= 5 &&
      (CONNECTION_REJECTED_MESSAGE.test(message) ||
        sqlState.startsWith('28') ||
        sqlState === '3D000' ||
        sqlState === '57P01' ||
        sqlState === '25P03'))
  ) {
    return 'connections';
  }
  if (
    AUTOVACUUM_MESSAGE.test(message) ||
    backendType === 'autovacuum worker' ||
    backendType === 'autovacuum launcher'
  ) {
    return 'autovacuum';
  }
  if (
    WAL_MESSAGE.test(message) ||
    backendType === 'checkpointer' ||
    backendType === 'walwriter' ||
    backendType === 'archiver' ||
    backendType === 'background writer'
  ) {
    return 'wal';
  }
  if (backendType === 'postmaster' || backendType === 'startup' || SERVER_MESSAGE.test(message)) {
    return 'server';
  }
  if (rank >= 4) {
    return 'errors';
  }
  return 'other';
}

const LOG_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) UTC$/;

/**
 * Prefer Postgres' own log_time (when it happened) over the zap ts (when it was relayed), and
 * fall back to ts, e.g. if the server logs in another time zone.
 */
export function parsePostgresLogTime(logTime: unknown, fallbackTs?: unknown): number {
  if (typeof logTime === 'string') {
    const match = LOG_TIME.exec(logTime);
    if (match) {
      const parsed = Date.parse(`${match[1]}T${match[2]}Z`);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return parseTimestamp(fallbackTs)?.getTime() ?? 0;
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'string' ? value : String(value);
}

// [record key, label]. Empty values and the "0" placeholders (no xid / query id) are skipped.
const FIELD_LABELS: [string, string][] = [
  ['user_name', 'user'],
  ['database_name', 'database'],
  ['connection_from', 'client'],
  ['application_name', 'application_name'],
  ['backend_type', 'backend_type'],
  ['process_id', 'pid'],
  ['command_tag', 'command_tag'],
  ['sql_state_code', 'sqlstate'],
  ['session_id', 'session_id'],
  ['session_line_num', 'session_line'],
  ['session_start_time', 'session_start'],
  ['virtual_transaction_id', 'virtual_xid'],
  ['transaction_id', 'xid'],
  ['query_id', 'query_id'],
];

const AUTHORIZED_APPLICATION = /^connection authorized:.* application_name=(\S+)/;

interface SessionIdentity {
  user?: string;
  application?: string;
}

/**
 * Postgres only fills user and application_name in on some of a session's lines ("connection
 * received" has neither; the application name is in the "connection authorized" text and the
 * disconnection record), so they are looked up per session to place the whole session, e.g. its
 * "connection received" line, alongside the rest.
 */
function identifySessions(
  lines: { message: string; record: Record<string, unknown> }[]
): Map<string, SessionIdentity> {
  const sessions = new Map<string, SessionIdentity>();
  for (const { message, record } of lines) {
    const id = str(record.session_id);
    if (!id) {
      continue;
    }
    const identity = sessions.get(id) ?? {};
    identity.user ??= str(record.user_name);
    identity.application ??=
      str(record.application_name) ?? AUTHORIZED_APPLICATION.exec(message)?.[1];
    sessions.set(id, identity);
  }
  return sessions;
}

/** Parses one pod's raw log chunks into Postgres log events, dropping non-record lines. */
export function toPostgresEntries(pod: string, rawLines: string[]): PostgresLogEntry[] {
  const entries: PostgresLogEntry[] = [];
  const parsed = parseCnpgLogLines(rawLines);
  const records = parsed.flatMap(line =>
    line.record && line.logger === 'postgres' ? [{ ...line, record: line.record }] : []
  );
  const sessions = identifySessions(records);
  for (const line of records) {
    const record = line.record;
    const get = (key: string) => str(record[key]);
    const session = sessions.get(get('session_id') ?? '');
    const time = parsePostgresLogTime(record.log_time, line.ts);
    const user = get('user_name');
    const backendType = get('backend_type');
    const sqlState = get('sql_state_code');

    const fields: [string, string][] = [];
    for (const [key, label] of FIELD_LABELS) {
      const value = get(key);
      if (value !== undefined && value !== '0') {
        fields.push([label, value]);
      }
    }

    const entry: PostgresLogEntry = {
      key: `${pod}|${get('session_id') ?? ''}|${get('session_line_num') ?? ''}|${
        get('log_time') ?? line.ts ?? ''
      }`,
      pod,
      time,
      severity: line.severity,
      category: categorizeRecord({
        message: line.message,
        severity: line.severity,
        sqlState,
        backendType,
        user: user ?? session?.user,
        client: get('connection_from'),
        applicationName: get('application_name') ?? session?.application,
      }),
      message: line.message,
      pid: get('process_id') ?? '',
      user,
      database: get('database_name'),
      client: get('connection_from'),
      applicationName: get('application_name'),
      backendType,
      sqlState,
      query: get('query'),
      detail: get('detail'),
      hint: get('hint'),
      context: get('context'),
      internalQuery: get('internal_query'),
      fields,
      raw: line.raw,
      searchText: '',
    };
    entry.searchText = [
      entry.message,
      pod,
      entry.severity,
      entry.user,
      entry.database,
      entry.client,
      entry.applicationName,
      entry.backendType,
      entry.sqlState,
      entry.pid,
      get('session_id'),
      entry.query,
      entry.detail,
      entry.hint,
      entry.context,
      entry.internalQuery,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    entries.push(entry);
  }
  for (const line of parsed) {
    // Postgres lines without a record are the plain-text duplicates; everything else is the
    // instance manager (or another CNPG component) logging on its own.
    if (!line.record && line.logger !== 'postgres') {
      const entry = toContainerEntry(pod, line, 'manager');
      if (entry) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

/** Maps zap level names onto the Postgres-style names used for ranking and color. */
export function normalizeSeverity(level: string): string {
  switch (level) {
    case 'WARN':
      return 'WARNING';
    case 'DPANIC':
      return 'PANIC';
    case 'ERR':
      return 'ERROR';
    case 'TRACE':
      return 'DEBUG';
    default:
      return level;
  }
}

function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Generic entries for a non-postgres container's structured lines. Lines without a timestamp
 * (plain text) are skipped: they can't be placed in time.
 */
function toContainerEntry(
  pod: string,
  line: ParsedLogLine,
  category: LogCategory
): PostgresLogEntry | undefined {
  const time = parseTimestamp(line.ts)?.getTime();
  if (time === undefined) {
    return undefined;
  }
  const severity = normalizeSeverity(line.severity);
  const fields = Object.entries(line.extra).map(
    ([key, value]) => [key, formatLogValue(value)] as [string, string]
  );
  return {
    key: `${pod}|${line.ts}|${hashString(line.raw)}`,
    pod,
    time,
    severity,
    category,
    message: line.message,
    logger: line.logger,
    pid: '',
    fields,
    raw: line.raw,
    searchText: [
      line.message,
      pod,
      severity,
      line.logger,
      ...fields.map(([key, value]) => `${key} ${value}`),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase(),
  };
}

export function toContainerEntries(pod: string, rawLines: string[]): PostgresLogEntry[] {
  return parseCnpgLogLines(rawLines).flatMap(line => toContainerEntry(pod, line, 'other') ?? []);
}

export interface PodContainers {
  spec: {
    containers: { name: string }[];
    initContainers?: { name: string }[];
  };
}

/**
 * Container names across the pods, as the per-pod viewer lists them: init containers first, then
 * regular ones, each once.
 */
export function instanceContainers(pods: readonly PodContainers[]): string[] {
  const names = new Set<string>();
  for (const pod of pods) {
    for (const container of pod.spec.initContainers ?? []) {
      names.add(container.name);
    }
    for (const container of pod.spec.containers) {
      names.add(container.name);
    }
  }
  return [...names];
}

/** Every field is optional; undefined (or empty) applies no filter. */
export interface LogFilters {
  /** Inclusive window in epoch ms. */
  from?: number;
  to?: number;
  pods?: ReadonlySet<string>;
  severity?: string;
  categories?: ReadonlySet<LogCategory>;
  search?: string;
}

export function filterEntries(
  entries: readonly PostgresLogEntry[],
  filters: LogFilters
): PostgresLogEntry[] {
  const { from, to, pods, severity, categories, search } = filters;
  const needle = search?.trim().toLowerCase();
  return entries.filter(
    entry =>
      (from === undefined || entry.time >= from) &&
      (to === undefined || entry.time <= to) &&
      (!pods || pods.size === 0 || pods.has(entry.pod)) &&
      (!severity || entry.severity === severity) &&
      (!categories || categories.size === 0 || categories.has(entry.category)) &&
      (!needle || entry.searchText.includes(needle))
  );
}

/** Distinct severities present, least to most severe: the options for the level filter. */
export function distinctSeverities(entries: readonly PostgresLogEntry[]): string[] {
  return Array.from(new Set(entries.map(entry => entry.severity).filter(Boolean))).sort(
    (a, b) => severityRank(a) - severityRank(b) || a.localeCompare(b)
  );
}

export function sortEntries(
  entries: readonly PostgresLogEntry[],
  direction: 'newest' | 'oldest'
): PostgresLogEntry[] {
  const sign = direction === 'newest' ? -1 : 1;
  return [...entries].sort((a, b) => sign * (a.time - b.time) || a.pod.localeCompare(b.pod));
}

export function countByCategory(entries: readonly PostgresLogEntry[]): Record<LogCategory, number> {
  const counts = Object.fromEntries(LOG_CATEGORIES.map(c => [c.id, 0])) as Record<
    LogCategory,
    number
  >;
  for (const entry of entries) {
    counts[entry.category]++;
  }
  return counts;
}

export interface LogBucket {
  start: number;
  total: number;
  warnings: number;
  /** ERROR, FATAL and PANIC. */
  errors: number;
}

function bucketIndex(time: number, from: number, to: number, count: number): number {
  if (time < from || time > to || count < 1) {
    return -1;
  }
  const width = (to - from) / count;
  return width <= 0 ? 0 : Math.min(count - 1, Math.floor((time - from) / width));
}

/** Splits [from, to] into `count` equal buckets and tallies lines, warnings and errors in each. */
export function bucketize(
  entries: readonly PostgresLogEntry[],
  from: number,
  to: number,
  count: number
): LogBucket[] {
  const width = count > 0 && to > from ? (to - from) / count : 0;
  const buckets: LogBucket[] = Array.from({ length: count }, (_, i) => ({
    start: from + i * width,
    total: 0,
    warnings: 0,
    errors: 0,
  }));
  for (const entry of entries) {
    const index = bucketIndex(entry.time, from, to, count);
    if (index < 0) {
      continue;
    }
    const bucket = buckets[index];
    bucket.total++;
    const rank = severityRank(entry.severity);
    if (rank >= 4) {
      bucket.errors++;
    } else if (rank === 3) {
      bucket.warnings++;
    }
  }
  return buckets;
}

/** Per-bucket count of entries matching `predicate` — the series behind a KPI sparkline. */
export function bucketCounts(
  entries: readonly PostgresLogEntry[],
  from: number,
  to: number,
  count: number,
  predicate: (entry: PostgresLogEntry) => boolean
): number[] {
  const series = new Array<number>(count).fill(0);
  for (const entry of entries) {
    if (!predicate(entry)) {
      continue;
    }
    const index = bucketIndex(entry.time, from, to, count);
    if (index >= 0) {
      series[index]++;
    }
  }
  return series;
}

/**
 * A connection that was refused: wrong password, unknown role or database, or no pg_hba.conf
 * entry (FATAL, SQLSTATE 28xxx or 3D000), from any client, replicas included. Logged even with
 * log_connections off; a session killed by an administrator (57P01) is not one.
 */
export const isFailedLogin = (entry: PostgresLogEntry): boolean =>
  severityRank(entry.severity) >= 5 &&
  (!!entry.sqlState?.startsWith('28') || entry.sqlState === '3D000');

/** A statement that ran longer than log_min_duration_statement. */
export const isSlowStatement = (entry: PostgresLogEntry): boolean =>
  entry.message.startsWith('duration:');

/** A session waited longer than deadlock_timeout for a lock, or the deadlock detector fired. */
export const isLockWait = (entry: PostgresLogEntry): boolean =>
  /still waiting for|detected deadlock while waiting/.test(entry.message);

export const isErrorOrFatal = (entry: PostgresLogEntry): boolean =>
  severityRank(entry.severity) >= 4;
