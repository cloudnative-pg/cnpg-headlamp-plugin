import { describe, expect, it } from 'vitest';
import {
  bucketCounts,
  bucketize,
  categorizeRecord,
  countByCategory,
  distinctSeverities,
  filterEntries,
  instanceContainers,
  isErrorOrFatal,
  isFailedLogin,
  isLockWait,
  isSlowStatement,
  LogCategory,
  normalizeSeverity,
  parsePostgresLogTime,
  PostgresLogEntry,
  severityGroup,
  severityRank,
  sortEntries,
  toContainerEntries,
  toPostgresEntries,
} from './postgresLog';

/** Wraps csvlog columns the way the CNPG instance manager relays them. */
function record(fields: Record<string, string>, ts = '2026-11-20T10:17:21.800Z'): string {
  return JSON.stringify({
    level: 'info',
    ts,
    logger: 'postgres',
    msg: 'record',
    logging_pod: 'demo1-1',
    record: {
      log_time: '2026-11-20 10:17:21.718 UTC',
      process_id: '1906',
      session_id: '6b001e31.772',
      session_line_num: '3',
      transaction_id: '0',
      error_severity: 'LOG',
      sql_state_code: '00000',
      backend_type: 'client backend',
      query_id: '0',
      ...fields,
    },
  });
}

describe('categorizeRecord', () => {
  const cases: [string, Parameters<typeof categorizeRecord>[0], LogCategory][] = [
    [
      'authorized connection',
      { message: 'connection authorized: user=app database=logdemo SSL enabled', severity: 'LOG' },
      'connections',
    ],
    [
      'disconnection',
      { message: 'disconnection: session time: 0:00:00.161', severity: 'LOG' },
      'connections',
    ],
    [
      'failed login',
      {
        message: 'password authentication failed for user "app"',
        severity: 'FATAL',
        sqlState: '28P01',
      },
      'connections',
    ],
    [
      'killed session',
      {
        message: 'terminating connection due to administrator command',
        severity: 'FATAL',
        sqlState: '57P01',
      },
      'connections',
    ],
    [
      'missing database on connect',
      { message: 'database "nope" does not exist', severity: 'FATAL', sqlState: '3D000' },
      'connections',
    ],
    [
      'DROP DATABASE of a missing database is an ordinary error, not a rejected connection',
      { message: 'database "nope" does not exist', severity: 'ERROR', sqlState: '3D000' },
      'errors',
    ],
    [
      'slow statement',
      { message: 'duration: 303.523 ms  statement: SELECT pg_sleep(0.3);', severity: 'LOG' },
      'statements',
    ],
    [
      'temp file',
      { message: 'temporary file: path "base/pgsql_tmp/x.0", size 42000000', severity: 'LOG' },
      'statements',
    ],
    [
      'statement text must not leak into other categories',
      {
        message: 'duration: 12.0 ms  statement: SELECT * FROM standby_archive WHERE deadlock = 1',
        severity: 'LOG',
      },
      'statements',
    ],
    [
      'lock wait',
      {
        message: 'process 2026 still waiting for ShareLock on transaction 799 after 500.577 ms',
        severity: 'LOG',
      },
      'locks',
    ],
    ['deadlock', { message: 'deadlock detected', severity: 'ERROR', sqlState: '40P01' }, 'locks'],
    [
      'lock timeout',
      {
        message: 'canceling statement due to lock timeout',
        severity: 'ERROR',
        sqlState: '55P03',
      },
      'locks',
    ],
    [
      'unique violation',
      {
        message: 'duplicate key value violates unique constraint "customers_pkey"',
        severity: 'ERROR',
        sqlState: '23505',
      },
      'constraints',
    ],
    [
      'checkpoint',
      {
        message: 'checkpoint complete: wrote 21 buffers',
        severity: 'LOG',
        backendType: 'checkpointer',
      },
      'wal',
    ],
    [
      'restartpoint',
      { message: 'restartpoint complete: wrote 1843 buffers', severity: 'LOG' },
      'wal',
    ],
    [
      'autovacuum',
      {
        message: 'automatic vacuum of table "logdemo.public.orders": index scans: 1',
        severity: 'LOG',
      },
      'autovacuum',
    ],
    [
      'autoanalyze',
      { message: 'automatic analyze of table "logdemo.public.orders"', severity: 'LOG' },
      'autovacuum',
    ],
    [
      'SIGHUP',
      {
        message: 'received SIGHUP, reloading configuration files',
        severity: 'LOG',
        backendType: 'postmaster',
      },
      'server',
    ],
    [
      'parameter change',
      { message: 'parameter "log_connections" changed to "on"', severity: 'LOG' },
      'server',
    ],
    [
      'WAL receiver (standby)',
      {
        message: 'started streaming WAL from primary at 0/C000000 on timeline 1',
        severity: 'LOG',
        backendType: 'walreceiver',
      },
      'standby',
    ],
    [
      'replication user connection',
      {
        message: 'connection authorized: user=streaming_replica database=postgres',
        severity: 'LOG',
        user: 'streaming_replica',
      },
      'standby',
    ],
    [
      'instance manager session',
      {
        message: 'connection authorized: user=postgres database=app application_name=x',
        severity: 'LOG',
        client: '[local]',
        applicationName: 'cnpg-instance-manager',
      },
      'internal',
    ],
    [
      'readiness probe disconnect',
      {
        message: 'disconnection: session time: 0:00:00.010 user=postgres database=postgres',
        severity: 'LOG',
        client: '[local]',
        applicationName: 'pg_isready',
      },
      'internal',
    ],
    [
      'local session of someone else (psql)',
      {
        message: 'connection authorized: user=postgres database=app application_name=psql',
        severity: 'LOG',
        client: '[local]',
        applicationName: 'psql',
      },
      'connections',
    ],
    [
      'local session whose application is not known yet',
      { message: 'connection received: host=[local]', severity: 'LOG', client: '[local]' },
      'connections',
    ],
    [
      'remote session that borrows an internal application name',
      {
        message: 'connection authorized: user=app database=app application_name=pg_isready',
        severity: 'LOG',
        client: '10.244.0.9:41234',
        applicationName: 'pg_isready',
      },
      'connections',
    ],
    [
      'failed local login of an internal application',
      {
        message: 'password authentication failed for user "postgres"',
        severity: 'FATAL',
        sqlState: '28P01',
        client: '[local]',
        applicationName: 'cnpg-instance-manager',
      },
      'connections',
    ],
    [
      'permission denied',
      { message: 'permission denied for table audit_log', severity: 'ERROR', sqlState: '42501' },
      'errors',
    ],
    [
      'statement timeout',
      {
        message: 'canceling statement due to statement timeout',
        severity: 'ERROR',
        sqlState: '57014',
      },
      'errors',
    ],
    [
      'application warning',
      { message: 'inventory below threshold for sku 4217', severity: 'WARNING' },
      'other',
    ],
    [
      // A client connected before recovery finished; FATAL severity but a normal startup
      // condition, not an application error. Must not fall into the severity-only 'errors' catch-all.
      'client connects before the system has finished starting up',
      { message: 'the database system is starting up', severity: 'FATAL', sqlState: '57P03' },
      'server',
    ],
    // Regressions: identifiers inside error messages must not drag them into another category.
    [
      'missing relation named like a WAL archive',
      { message: 'relation "archive_log" does not exist', severity: 'ERROR', sqlState: '42P01' },
      'errors',
    ],
    [
      'missing relation named like a standby',
      { message: 'relation "standby_orders" does not exist', severity: 'ERROR', sqlState: '42P01' },
      'errors',
    ],
    [
      'role does not exist inside a session',
      { message: 'role "ghost" does not exist', severity: 'ERROR', sqlState: '42704' },
      'errors',
    ],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(categorizeRecord(input)).toBe(expected);
  });
});

describe('severity helpers', () => {
  it('orders severities', () => {
    expect(
      ['DEBUG2', 'LOG', 'NOTICE', 'WARNING', 'ERROR', 'FATAL', 'PANIC'].map(severityRank)
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(severityRank('INFO')).toBe(severityRank('LOG'));
  });

  it('groups PANIC with FATAL and unknowns with debug', () => {
    expect(severityGroup('PANIC')).toBe('fatal');
    expect(severityGroup('INFO')).toBe('log');
    expect(severityGroup('DEBUG5')).toBe('debug');
    expect(severityGroup('')).toBe('debug');
  });
});

describe('parsePostgresLogTime', () => {
  it('reads Postgres log_time as UTC, keeping milliseconds', () => {
    expect(parsePostgresLogTime('2026-11-20 10:17:21.718 UTC')).toBe(
      Date.parse('2026-11-20T10:17:21.718Z')
    );
  });

  it('falls back to the zap timestamp when log_time is in another zone or missing', () => {
    const ts = '2026-11-20T10:17:21.800Z';
    expect(parsePostgresLogTime('2026-11-20 15:47:21.718 IST', ts)).toBe(Date.parse(ts));
    expect(parsePostgresLogTime(undefined, ts)).toBe(Date.parse(ts));
    expect(parsePostgresLogTime(undefined, undefined)).toBe(0);
  });
});

describe('toPostgresEntries', () => {
  const lines = [
    // an instance-manager line (kept as 'manager') and the plain-text duplicate of a record (dropped)
    JSON.stringify({
      level: 'info',
      ts: '2026-11-20T10:17:00Z',
      logger: 'instance-manager',
      msg: 'reloading the instance',
    }),
    JSON.stringify({
      level: 'info',
      ts: '2026-11-20T10:17:00Z',
      logger: 'postgres',
      msg: '2026-11-20 10:17:00.000 UTC [32] LOG:  hello',
      pipe: 'stderr',
    }),
    record({
      user_name: 'app',
      database_name: 'logdemo',
      connection_from: '10.244.0.1:2148',
      application_name: 'orders-worker',
      message: 'connection authorized: user=app database=logdemo application_name=orders-worker',
    }),
    record(
      {
        error_severity: 'ERROR',
        sql_state_code: '23505',
        session_line_num: '4',
        message: 'duplicate key value violates unique constraint "customers_pkey"',
        detail: 'Key (id)=(1) already exists.',
        query: 'INSERT INTO customers (id) VALUES (1);',
        user_name: 'app',
      },
      '2026-11-20T10:17:28.400Z'
    ),
  ];

  it('keeps structured postgres records and instance-manager lines', () => {
    const entries = toPostgresEntries('demo1-1', lines);
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.category)).toEqual(['connections', 'constraints', 'manager']);
    expect(entries[2]).toMatchObject({
      message: 'reloading the instance',
      logger: 'instance-manager',
      severity: 'INFO',
    });
  });

  it('extracts the fields the UI shows', () => {
    const [connection, violation] = toPostgresEntries('demo1-1', lines);
    expect(connection).toMatchObject({
      pod: 'demo1-1',
      severity: 'LOG',
      pid: '1906',
      user: 'app',
      database: 'logdemo',
      client: '10.244.0.1:2148',
      applicationName: 'orders-worker',
      time: Date.parse('2026-11-20T10:17:21.718Z'),
    });
    expect(violation).toMatchObject({
      severity: 'ERROR',
      sqlState: '23505',
      detail: 'Key (id)=(1) already exists.',
      query: 'INSERT INTO customers (id) VALUES (1);',
    });
    // "0" placeholders (xid, query_id) are hidden; real values are kept in order.
    const labels = connection.fields.map(([label]) => label);
    expect(labels).not.toContain('xid');
    expect(labels).not.toContain('query_id');
    expect(labels.slice(0, 3)).toEqual(['user', 'database', 'client']);
    // pid left the table, so it must stay reachable in the panel.
    expect(connection.fields).toContainEqual(['pid', '1906']);
  });

  it('gives each record a distinct, stable key', () => {
    const first = toPostgresEntries('demo1-1', lines);
    const again = toPostgresEntries('demo1-1', lines);
    expect(first[0].key).not.toBe(first[1].key);
    expect(again.map(e => e.key)).toEqual(first.map(e => e.key));
    expect(toPostgresEntries('demo1-2', lines)[0].key).not.toBe(first[0].key);
  });

  describe('local sessions', () => {
    // application_name is only on the "authorized" text and the disconnection record, never on
    // "received" or "authenticated": the session id ties the four lines together.
    const session = (id: string, application: string) => {
      const base = { session_id: id, connection_from: '[local]', user_name: 'postgres' };
      return [
        record({
          ...base,
          user_name: '',
          session_line_num: '1',
          message: 'connection received: host=[local]',
        }),
        record({
          ...base,
          session_line_num: '2',
          message: 'connection authenticated: identity="postgres" method=peer',
        }),
        record({
          ...base,
          session_line_num: '3',
          message: `connection authorized: user=postgres database=app application_name=${application}`,
        }),
        record({
          ...base,
          session_line_num: '4',
          application_name: application,
          message: 'disconnection: session time: 0:00:00.010 user=postgres database=app',
        }),
      ];
    };

    it('files every line of a CloudNativePG session under Internal', () => {
      const entries = toPostgresEntries('demo1-1', session('6b048c19.2e', 'cnpg-instance-manager'));
      expect(entries.map(e => e.category)).toEqual([
        'internal',
        'internal',
        'internal',
        'internal',
      ]);
    });

    it('keeps a human psql session under Connections', () => {
      const entries = toPostgresEntries('demo1-1', session('6b048c19.30', 'psql'));
      expect(entries.map(e => e.category)).toEqual([
        'connections',
        'connections',
        'connections',
        'connections',
      ]);
    });

    it('keeps sessions apart by session id', () => {
      const entries = toPostgresEntries('demo1-1', [
        ...session('6b048c19.2e', 'pg_isready'),
        ...session('6b048c19.30', 'psql'),
      ]);
      expect(entries.map(e => e.category)).toEqual([
        ...Array(4).fill('internal'),
        ...Array(4).fill('connections'),
      ]);
    });

    it('files the metrics exporter session under Internal', () => {
      const entries = toPostgresEntries('demo1-1', session('6b048c19.31', 'cnpg_metrics_exporter'));
      expect(new Set(entries.map(e => e.category))).toEqual(new Set(['internal']));
    });

    it('files a replica’s "connection received" line under Standby with the rest of its session', () => {
      const base = { session_id: '6b048c19.40', connection_from: '10.244.0.7:48034' };
      const entries = toPostgresEntries('demo1-1', [
        record({ ...base, session_line_num: '1', message: 'connection received: host=10.244.0.7' }),
        record({
          ...base,
          session_line_num: '2',
          user_name: 'streaming_replica',
          message: 'connection authorized: user=streaming_replica database=postgres',
        }),
      ]);
      expect(entries.map(e => e.category)).toEqual(['standby', 'standby']);
    });

    it('leaves a session whose later lines were not loaded under Connections', () => {
      const [received] = session('6b048c19.2e', 'pg_isready');
      expect(toPostgresEntries('demo1-1', [received])[0].category).toBe('connections');
    });
  });

  it('copes with a record split across two chunks', () => {
    const whole = record({ message: 'checkpoint starting: time', backend_type: 'checkpointer' });
    const entries = toPostgresEntries('demo1-1', [whole.slice(0, 80), whole.slice(80) + '\n']);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('wal');
  });
});

describe('filtering and sorting', () => {
  function entry(overrides: Partial<PostgresLogEntry>): PostgresLogEntry {
    return {
      key: Math.random().toString(),
      pod: 'demo1-1',
      time: 1000,
      severity: 'LOG',
      category: 'other',
      message: 'm',
      pid: '1',
      fields: [],
      raw: '{}',
      searchText: 'm',
      ...overrides,
    };
  }
  const entries = [
    entry({
      time: 1000,
      pod: 'demo1-1',
      severity: 'LOG',
      category: 'connections',
      searchText: 'connection authorized app',
    }),
    entry({
      time: 2000,
      pod: 'demo1-2',
      severity: 'WARNING',
      category: 'other',
      searchText: 'inventory low',
    }),
    entry({
      time: 3000,
      pod: 'demo1-1',
      severity: 'ERROR',
      category: 'errors',
      searchText: 'permission denied audit_log',
    }),
    entry({
      time: 4000,
      pod: 'demo1-3',
      severity: 'FATAL',
      category: 'connections',
      searchText: 'password authentication failed',
    }),
  ];

  it('applies each filter independently', () => {
    expect(filterEntries(entries, { from: 2000, to: 3000 }).map(e => e.time)).toEqual([2000, 3000]);
    expect(filterEntries(entries, { pods: new Set(['demo1-1']) })).toHaveLength(2);
    expect(filterEntries(entries, { severity: 'ERROR' }).map(e => e.severity)).toEqual(['ERROR']);
    expect(filterEntries(entries, { severity: 'FATAL' })).toHaveLength(1);
    expect(filterEntries(entries, { severity: 'NOTICE' })).toHaveLength(0);
    expect(
      filterEntries(entries, { categories: new Set<LogCategory>(['connections']) })
    ).toHaveLength(2);
    expect(filterEntries(entries, { search: ' PERMISSION ' })).toHaveLength(1);
  });

  it('treats empty sets and an empty search as "no filter"', () => {
    expect(
      filterEntries(entries, { pods: new Set(), categories: new Set(), search: '  ' })
    ).toHaveLength(4);
  });

  it('combines filters', () => {
    expect(
      filterEntries(entries, {
        severity: 'FATAL',
        categories: new Set<LogCategory>(['connections']),
      })
    ).toHaveLength(1);
    expect(
      filterEntries(entries, {
        severity: 'ERROR',
        categories: new Set<LogCategory>(['connections']),
      })
    ).toHaveLength(0);
  });

  it('lists only the severities present, least to most severe', () => {
    expect(distinctSeverities(entries)).toEqual(['LOG', 'WARNING', 'ERROR', 'FATAL']);
    expect(distinctSeverities([])).toEqual([]);
  });

  it('sorts newest-first and oldest-first without mutating the input', () => {
    expect(sortEntries(entries, 'newest').map(e => e.time)).toEqual([4000, 3000, 2000, 1000]);
    expect(sortEntries(entries, 'oldest').map(e => e.time)).toEqual([1000, 2000, 3000, 4000]);
    expect(entries.map(e => e.time)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('counts by category', () => {
    expect(countByCategory(entries)).toMatchObject({ connections: 2, errors: 1, other: 1, wal: 0 });
  });
});

describe('time buckets', () => {
  const at = (time: number, severity = 'LOG', message = 'm'): PostgresLogEntry =>
    ({
      key: String(time) + severity,
      pod: 'p',
      time,
      severity,
      category: 'other',
      message,
      pid: '1',
      fields: [],
      raw: '{}',
      searchText: '',
    } as PostgresLogEntry);

  it('assigns entries to equal buckets, with the end of the window in the last bucket', () => {
    const buckets = bucketize([at(0), at(24), at(25), at(99), at(100)], 0, 100, 4);
    expect(buckets.map(b => b.total)).toEqual([2, 1, 0, 2]);
    expect(buckets.map(b => b.start)).toEqual([0, 25, 50, 75]);
  });

  it('tracks warnings and errors per bucket and ignores entries outside the window', () => {
    const buckets = bucketize(
      [at(10, 'WARNING'), at(11, 'ERROR'), at(12, 'FATAL'), at(13, 'LOG'), at(500, 'ERROR')],
      0,
      100,
      2
    );
    expect(buckets[0]).toMatchObject({ total: 4, warnings: 1, errors: 2 });
    expect(buckets[1].total).toBe(0);
  });

  it('handles an empty or zero-width window', () => {
    expect(bucketize([], 0, 100, 3).every(b => b.total === 0)).toBe(true);
    expect(bucketize([at(5)], 5, 5, 3).map(b => b.total)).toEqual([1, 0, 0]);
  });

  it('builds a per-bucket series for a predicate', () => {
    const series = bucketCounts(
      [at(1, 'LOG', 'duration: 5 ms'), at(2, 'LOG', 'other'), at(60, 'LOG', 'duration: 9 ms')],
      0,
      100,
      2,
      isSlowStatement
    );
    expect(series).toEqual([1, 1]);
  });
});

describe('KPI predicates', () => {
  const make = (message: string, category: LogCategory, severity = 'LOG') =>
    ({ message, category, severity } as PostgresLogEntry);

  it('counts refused connections only', () => {
    const refused = (
      message: string,
      sqlState: string,
      severity = 'FATAL',
      category: LogCategory = 'connections'
    ) => ({ message, category, severity, sqlState } as PostgresLogEntry);
    // A replica refused at the door is as much a failed login as an application.
    expect(
      isFailedLogin(
        refused('no pg_hba.conf entry for replication connection', '28000', 'FATAL', 'standby')
      )
    ).toBe(true);
    expect(isFailedLogin(refused('password authentication failed for user "app"', '28P01'))).toBe(
      true
    );
    expect(isFailedLogin(refused('role "ghost" does not exist', '28000'))).toBe(true);
    expect(isFailedLogin(refused('database "nope" does not exist', '3D000'))).toBe(true);
    expect(
      isFailedLogin(refused('terminating connection due to administrator command', '57P01'))
    ).toBe(false);
    expect(isFailedLogin(refused('connection authorized: user=app', '00000', 'LOG'))).toBe(false);
  });

  it('counts slow statements, lock waits and errors', () => {
    expect(isSlowStatement(make('duration: 1.0 ms  statement: x', 'statements'))).toBe(true);
    expect(isSlowStatement(make('statement: CREATE TABLE x ()', 'statements'))).toBe(false);
    expect(
      isLockWait(
        make('process 9 still waiting for ShareLock on transaction 5 after 500 ms', 'locks')
      )
    ).toBe(true);
    expect(
      isLockWait(make('process 9 acquired ShareLock on transaction 5 after 2000 ms', 'locks'))
    ).toBe(false);
    expect(
      isLockWait(make('process 9 detected deadlock while waiting for ShareLock', 'locks'))
    ).toBe(true);
    expect(isErrorOrFatal(make('x', 'errors', 'FATAL'))).toBe(true);
    expect(isErrorOrFatal(make('x', 'other', 'WARNING'))).toBe(false);
  });
});

describe('toContainerEntries', () => {
  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({
      level: 'info',
      ts: '2026-11-20T10:17:21.800Z',
      logger: 'wal-archive',
      ...fields,
    });

  it('maps a structured sidecar line to a generic entry', () => {
    const [entry] = toContainerEntries('demo1-1', [
      line({ msg: 'Archived WAL file', walName: '000000010000000000000007', elapsed: 1.5 }),
    ]);
    expect(entry).toMatchObject({
      pod: 'demo1-1',
      severity: 'INFO',
      category: 'other',
      message: 'Archived WAL file',
      logger: 'wal-archive',
      time: Date.parse('2026-11-20T10:17:21.800Z'),
    });
    // Everything beyond ts/level/logger/msg is kept as parsed fields.
    expect(entry.fields).toEqual([
      ['walName', '000000010000000000000007'],
      ['elapsed', '1.5'],
    ]);
    expect(entry.searchText).toContain('walname 000000010000000000000007');
  });

  it('normalizes zap level names onto the ones the tab ranks', () => {
    expect(
      ['warn', 'error', 'dpanic', 'panic', 'fatal', 'debug', 'info'].map(
        level => toContainerEntries('p', [line({ level, msg: 'x' })])[0].severity
      )
    ).toEqual(['WARNING', 'ERROR', 'PANIC', 'PANIC', 'FATAL', 'DEBUG', 'INFO']);
    expect(normalizeSeverity('')).toBe('');
  });

  it('skips lines it cannot place in time, and keeps distinct keys for distinct lines', () => {
    const entries = toContainerEntries('demo1-1', [
      'a plain text line\n',
      JSON.stringify({ level: 'info', msg: 'no timestamp' }),
      line({ msg: 'first' }),
      line({ msg: 'second' }),
    ]);
    expect(entries.map(e => e.message)).toEqual(['first', 'second']);
    expect(entries[0].key).not.toBe(entries[1].key);
  });
});

describe('instanceContainers', () => {
  const pod = (containers: string[], init: string[] = []) => ({
    spec: {
      containers: containers.map(name => ({ name })),
      initContainers: init.map(name => ({ name })),
    },
  });

  it('lists init containers first, then regular ones, like the per-pod viewer', () => {
    expect(instanceContainers([pod(['postgres'], ['bootstrap-controller'])])).toEqual([
      'bootstrap-controller',
      'postgres',
    ]);
  });

  it('includes sidecars (native or regular), each name once across pods', () => {
    const withPlugin = pod(['postgres'], ['bootstrap-controller', 'plugin-barman-cloud']);
    expect(
      instanceContainers([withPlugin, withPlugin, pod(['postgres', 'metrics-exporter'])])
    ).toEqual(['bootstrap-controller', 'plugin-barman-cloud', 'postgres', 'metrics-exporter']);
  });

  it('copes with pods that have no init containers at all, and with no pods', () => {
    expect(instanceContainers([{ spec: { containers: [{ name: 'postgres' }] } }])).toEqual([
      'postgres',
    ]);
    expect(instanceContainers([])).toEqual([]);
  });
});
