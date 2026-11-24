// The curated set of PostgreSQL parameters offered as dedicated fields in the configuration
// editor. Everything else is still editable through the free-form rows.
//
// Every entry here must be a parameter the operator lets users change: CNPG's webhook rejects
// the ones it manages (`shared_preload_libraries`, `archive_*`, `ssl*`, `log_destination`, ...),
// so don't add those. We deliberately don't hardcode the operator's list of fixed parameters or
// parse/validate values client-side — the webhook and PostgreSQL are the authority, and their
// error message is shown in the dialog when a change is rejected.

export interface ParameterSpec {
  name: string;
  /** One-line explanation shown in the field's tooltip. */
  description: string;
  /** Example values shown in the tooltip (PostgreSQL's own syntax, including units). */
  examples: string[];
  /** Known values suggested while typing; the field still accepts anything (free-solo). */
  options?: string[];
  /** Changing it makes the operator restart the instances (a rolling update). */
  restart?: boolean;
}

export interface ParameterGroup {
  title: string;
  parameters: ParameterSpec[];
}

const ON_OFF = ['on', 'off'];

export const PARAMETER_GROUPS: ParameterGroup[] = [
  {
    title: 'Memory',
    parameters: [
      {
        name: 'shared_buffers',
        description: 'Memory used by PostgreSQL for caching data pages.',
        examples: ['256MB', '1GB'],
        restart: true,
      },
      {
        name: 'work_mem',
        description: 'Memory per sort or hash operation before spilling to disk.',
        examples: ['4MB', '16MB'],
      },
      {
        name: 'maintenance_work_mem',
        description: 'Memory for maintenance operations such as VACUUM and CREATE INDEX.',
        examples: ['64MB', '512MB'],
      },
    ],
  },
  {
    title: 'Connections',
    parameters: [
      {
        name: 'max_connections',
        description: 'Maximum number of concurrent client connections.',
        examples: ['100', '200'],
        restart: true,
      },
    ],
  },
  {
    title: 'WAL & checkpoints',
    parameters: [
      {
        name: 'max_wal_size',
        description: 'WAL size that triggers a checkpoint.',
        examples: ['1GB', '4GB'],
      },
      {
        name: 'min_wal_size',
        description: 'WAL files below this size are recycled rather than removed.',
        examples: ['80MB', '512MB'],
      },
      {
        name: 'checkpoint_timeout',
        description: 'Maximum time between automatic checkpoints.',
        examples: ['5min', '15min'],
      },
      {
        name: 'checkpoint_completion_target',
        description: 'Fraction of the checkpoint interval over which writes are spread.',
        examples: ['0.9'],
      },
      {
        name: 'wal_compression',
        description: 'Compress full-page images written to the WAL.',
        examples: ['off', 'lz4', 'zstd'],
        options: ['off', 'on', 'pglz', 'lz4', 'zstd'],
      },
      {
        name: 'wal_keep_size',
        description: 'Minimum WAL retained in pg_wal for standbys to catch up.',
        examples: ['512MB', '2GB'],
      },
    ],
  },
  {
    title: 'Workers',
    parameters: [
      {
        name: 'max_worker_processes',
        description: 'Maximum number of background worker processes.',
        examples: ['8', '32'],
        restart: true,
      },
      {
        name: 'max_parallel_workers',
        description: 'Maximum number of workers available for parallel operations.',
        examples: ['8', '16'],
      },
      {
        name: 'max_parallel_workers_per_gather',
        description: 'Maximum number of workers a single parallel query node can use.',
        examples: ['0', '2'],
      },
      {
        name: 'max_parallel_maintenance_workers',
        description: 'Maximum number of workers for parallel maintenance commands.',
        examples: ['2', '4'],
      },
    ],
  },
  {
    title: 'Timeouts',
    parameters: [
      {
        name: 'statement_timeout',
        description: 'Abort statements running longer than this. 0 disables it.',
        examples: ['0', '30s', '5min'],
      },
      {
        name: 'lock_timeout',
        description: 'Abort statements waiting longer than this for a lock. 0 disables it.',
        examples: ['0', '10s'],
      },
      {
        name: 'idle_in_transaction_session_timeout',
        description: 'Terminate sessions idle in a transaction for longer than this.',
        examples: ['0', '5min'],
      },
    ],
  },
  {
    title: 'Logging',
    parameters: [
      {
        name: 'log_min_duration_statement',
        description: 'Log statements slower than this. -1 disables it, 0 logs everything.',
        examples: ['-1', '250ms', '1s'],
      },
      {
        name: 'log_statement',
        description: 'Which kinds of statements to log.',
        examples: ['none', 'ddl', 'mod', 'all'],
        options: ['none', 'ddl', 'mod', 'all'],
      },
      {
        name: 'log_lock_waits',
        description: 'Log when a session waits longer than deadlock_timeout for a lock.',
        examples: ['on', 'off'],
        options: ON_OFF,
      },
      {
        name: 'log_checkpoints',
        description: 'Log each checkpoint and restartpoint.',
        examples: ['on', 'off'],
        options: ON_OFF,
      },
      {
        name: 'log_disconnections',
        description: 'Log the end of each client session, with its duration.',
        examples: ['on', 'off'],
        options: ON_OFF,
      },
    ],
  },
];

export const CURATED_PARAMETER_NAMES: ReadonlySet<string> = new Set(
  PARAMETER_GROUPS.flatMap(group => group.parameters.map(parameter => parameter.name))
);

export const RESTART_PARAMETER_NAMES: ReadonlySet<string> = new Set(
  PARAMETER_GROUPS.flatMap(group =>
    group.parameters.filter(parameter => parameter.restart).map(parameter => parameter.name)
  )
);
