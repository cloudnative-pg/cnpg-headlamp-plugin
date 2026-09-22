import {
  countMetricWhere,
  extensionsWithUpdate,
  formatBytes,
  groupSeriesByLabel,
  maxMetric,
  metricByLabel,
  parsePrometheusText,
  scalarMetric,
  sumMetric,
} from './promScrape';

describe('parsePrometheusText', () => {
  test('parses a scalar metric with no labels', () => {
    const series = parsePrometheusText('cnpg_collector_up 1');
    expect(series.get('cnpg_collector_up')).toEqual([{ labels: {}, value: 1 }]);
  });

  test('parses a single label into a key/value pair', () => {
    const series = parsePrometheusText('cnpg_pg_database_size_bytes{datname="app"} 8017599');
    expect(series.get('cnpg_pg_database_size_bytes')).toEqual([
      { labels: { datname: 'app' }, value: 8017599 },
    ]);
  });

  test('parses multiple labels on one sample, including an empty label value', () => {
    const series = parsePrometheusText(
      'cnpg_backends_total{application_name="test1-2",datname="",state="active",usename="streaming_replica"} 1'
    );
    expect(series.get('cnpg_backends_total')?.[0].labels).toEqual({
      application_name: 'test1-2',
      datname: '',
      state: 'active',
      usename: 'streaming_replica',
    });
  });

  test('accumulates multiple samples reported under the same metric name', () => {
    const series = parsePrometheusText(
      [
        'cnpg_pg_database_size_bytes{datname="app"} 100',
        'cnpg_pg_database_size_bytes{datname="postgres"} 200',
      ].join('\n')
    );
    const samples = series.get('cnpg_pg_database_size_bytes');
    expect(samples).toHaveLength(2);
    expect(samples?.map(s => s.value)).toEqual([100, 200]);
  });

  test('skips HELP/TYPE comments and blank lines', () => {
    const series = parsePrometheusText(
      [
        '# HELP cnpg_collector_up 1 if PostgreSQL is up, 0 otherwise.',
        '# TYPE cnpg_collector_up gauge',
        '',
        'cnpg_collector_up 1',
        '',
      ].join('\n')
    );
    expect(series.size).toBe(1);
    expect(series.get('cnpg_collector_up')).toEqual([{ labels: {}, value: 1 }]);
  });

  test('parses scientific notation and negative values', () => {
    const series = parsePrometheusText(
      [
        'cnpg_collector_pg_wal{value="size"} 1.50994944e+08',
        'cnpg_pg_stat_archiver_last_failed_time -1',
      ].join('\n')
    );
    expect(series.get('cnpg_collector_pg_wal')?.[0].value).toBeCloseTo(150994944);
    expect(series.get('cnpg_pg_stat_archiver_last_failed_time')?.[0].value).toBe(-1);
  });

  test('skips a sample whose value is the literal NaN', () => {
    const series = parsePrometheusText('cnpg_collector_pg_wal{value="slots_max"} NaN');
    expect(series.size).toBe(0);
  });

  test('returns an empty series for empty input', () => {
    expect(parsePrometheusText('').size).toBe(0);
  });
});

describe('scalarMetric', () => {
  test('returns the value of an unlabeled metric', () => {
    const series = parsePrometheusText('cnpg_backends_waiting_total 3');
    expect(scalarMetric(series, 'cnpg_backends_waiting_total')).toBe(3);
  });

  test('returns 0 when the metric is absent', () => {
    expect(scalarMetric(parsePrometheusText(''), 'cnpg_backends_waiting_total')).toBe(0);
  });
});

describe('sumMetric', () => {
  const series = parsePrometheusText(
    [
      'cnpg_pg_stat_database_deadlocks{datname="app"} 1',
      'cnpg_pg_stat_database_deadlocks{datname="postgres"} 2',
      'cnpg_backends_total{usename="streaming_replica"} 1',
      'cnpg_backends_total{usename="app_user"} 4',
    ].join('\n')
  );

  test('sums every sample for a metric', () => {
    expect(sumMetric(series, 'cnpg_pg_stat_database_deadlocks')).toBe(3);
  });

  test('drops samples matching the exclude filter before summing', () => {
    expect(
      sumMetric(series, 'cnpg_backends_total', {
        label: 'usename',
        values: ['streaming_replica'],
      })
    ).toBe(4);
  });

  test('returns 0 when the metric is absent', () => {
    expect(sumMetric(series, 'does_not_exist')).toBe(0);
  });
});

describe('maxMetric', () => {
  test('returns the largest value across samples', () => {
    const series = parsePrometheusText(
      [
        'cnpg_pg_stat_replication_replay_diff_bytes{application_name="a"} 100',
        'cnpg_pg_stat_replication_replay_diff_bytes{application_name="b"} 900',
      ].join('\n')
    );
    expect(maxMetric(series, 'cnpg_pg_stat_replication_replay_diff_bytes')).toBe(900);
  });

  test('returns 0 when the metric is absent', () => {
    expect(maxMetric(parsePrometheusText(''), 'does_not_exist')).toBe(0);
  });
});

describe('countMetricWhere', () => {
  test('counts samples matching the predicate', () => {
    const series = parsePrometheusText(
      [
        'cnpg_pg_replication_slots_active{slot_name="a"} 1',
        'cnpg_pg_replication_slots_active{slot_name="b"} 0',
        'cnpg_pg_replication_slots_active{slot_name="c"} 0',
      ].join('\n')
    );
    expect(
      countMetricWhere(series, 'cnpg_pg_replication_slots_active', value => value === 0)
    ).toBe(2);
  });

  test('returns 0 when no sample matches', () => {
    const series = parsePrometheusText('cnpg_pg_replication_slots_active{slot_name="a"} 1');
    expect(
      countMetricWhere(series, 'cnpg_pg_replication_slots_active', value => value === 0)
    ).toBe(0);
  });
});

describe('metricByLabel', () => {
  const series = parsePrometheusText(
    [
      'cnpg_collector_sync_replicas{value="observed"} 1',
      'cnpg_collector_sync_replicas{value="expected"} 2',
    ].join('\n')
  );

  test('returns the value of the sample matching the label', () => {
    expect(metricByLabel(series, 'cnpg_collector_sync_replicas', 'value', 'expected')).toBe(2);
  });

  test('returns 0 when no sample matches the label value', () => {
    expect(metricByLabel(series, 'cnpg_collector_sync_replicas', 'value', 'max')).toBe(0);
  });
});

describe('groupSeriesByLabel', () => {
  test('joins several metrics into one row per label value', () => {
    const series = parsePrometheusText(
      [
        'cnpg_pg_stat_replication_write_diff_bytes{application_name="test1-2"} 10',
        'cnpg_pg_stat_replication_replay_diff_bytes{application_name="test1-2"} 20',
        'cnpg_pg_stat_replication_write_diff_bytes{application_name="test1-3"} 30',
      ].join('\n')
    );
    const rows = groupSeriesByLabel(
      series,
      ['cnpg_pg_stat_replication_write_diff_bytes', 'cnpg_pg_stat_replication_replay_diff_bytes'],
      'application_name'
    );

    expect(rows.get('test1-2')?.values).toEqual({
      cnpg_pg_stat_replication_write_diff_bytes: 10,
      cnpg_pg_stat_replication_replay_diff_bytes: 20,
    });
    expect(rows.get('test1-3')?.values).toEqual({
      cnpg_pg_stat_replication_write_diff_bytes: 30,
    });
  });

  test('skips samples missing the grouping label', () => {
    const series = parsePrometheusText('cnpg_pg_stat_replication_write_diff_bytes 10');
    const rows = groupSeriesByLabel(
      series,
      ['cnpg_pg_stat_replication_write_diff_bytes'],
      'application_name'
    );
    expect(rows.size).toBe(0);
  });
});

describe('extensionsWithUpdate', () => {
  const series = parsePrometheusText(
    [
      'cnpg_pg_extensions_update_available{datname="app",extname="plpgsql"} 0',
      'cnpg_pg_extensions_update_available{datname="app",extname="pgcrypto"} 1',
      'cnpg_pg_extensions_update_available{datname="postgres",extname="plpgsql"} 1',
    ].join('\n')
  );

  test('lists only extensions with an update available for the given database', () => {
    expect(extensionsWithUpdate(series, 'app')).toEqual(['pgcrypto']);
  });

  test('returns an empty list when nothing needs an update', () => {
    expect(extensionsWithUpdate(series, 'template1')).toEqual([]);
  });
});

describe('formatBytes', () => {
  test('shows sub-kB values as plain bytes', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(500)).toBe('500 bytes');
  });

  test('scales into kB/MB with two decimals once past 1024', () => {
    expect(formatBytes(1536)).toBe('1.50 kB');
    expect(formatBytes(24134717)).toBe('23.02 MB');
  });

  test('caps scaling at TB', () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe('5.00 TB');
  });
});
