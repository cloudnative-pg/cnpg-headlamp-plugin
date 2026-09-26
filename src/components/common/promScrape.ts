import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import { Pod } from './podActions';

export interface PrometheusSample {
  labels: Record<string, string>;
  value: number;
}

export type PrometheusSeries = Map<string, PrometheusSample[]>;

export interface PodMetricsResult {
  loading: boolean;
  series: PrometheusSeries | null;
  error: string | null;
}

const LABELS_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)\{(.*)\}$/;
const LABEL_PAIR_RE = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

// Prometheus text exposition format: `name{labels} value` or `name value`, `#` comments skipped.
export function parsePrometheusText(text: string): PrometheusSeries {
  const series: PrometheusSeries = new Map();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const lastSpace = line.lastIndexOf(' ');
    if (lastSpace === -1) {
      continue;
    }
    const head = line.slice(0, lastSpace);
    const value = Number(line.slice(lastSpace + 1));
    if (Number.isNaN(value)) {
      continue;
    }

    let name = head;
    const labels: Record<string, string> = {};
    const match = head.match(LABELS_RE);
    if (match) {
      name = match[1];
      for (const pair of match[2].matchAll(LABEL_PAIR_RE)) {
        labels[pair[1]] = pair[2];
      }
    }

    const samples = series.get(name);
    if (samples) {
      samples.push({ labels, value });
    } else {
      series.set(name, [{ labels, value }]);
    }
  }

  return series;
}

function samplesFor(series: PrometheusSeries, name: string): PrometheusSample[] {
  return series.get(name) ?? [];
}

export function scalarMetric(series: PrometheusSeries, name: string): number {
  return samplesFor(series, name)[0]?.value ?? 0;
}

// `exclude` drops samples matching a label value, approximating a SQL WHERE filter no label covers.
export function sumMetric(
  series: PrometheusSeries,
  name: string,
  exclude?: { label: string; values: string[] }
): number {
  return samplesFor(series, name).reduce((total, sample) => {
    if (exclude && exclude.values.includes(sample.labels[exclude.label])) {
      return total;
    }
    return total + sample.value;
  }, 0);
}

export function maxMetric(series: PrometheusSeries, name: string): number {
  return samplesFor(series, name).reduce((max, sample) => Math.max(max, sample.value), 0);
}

export function countMetricWhere(
  series: PrometheusSeries,
  name: string,
  predicate: (value: number) => boolean
): number {
  return samplesFor(series, name).filter(sample => predicate(sample.value)).length;
}

// For metric families keyed by a `value` label (e.g. cnpg_collector_sync_replicas{value="expected"}).
export function metricByLabel(
  series: PrometheusSeries,
  name: string,
  labelKey: string,
  labelValue: string
): number {
  return (
    samplesFor(series, name).find(sample => sample.labels[labelKey] === labelValue)?.value ?? 0
  );
}

// cnpg_pg_extensions_update_available carries multiple extname rows per datname, so it can't
// go through groupSeriesByLabel (one value per metric name per row) like the other tables.
export function extensionsWithUpdate(series: PrometheusSeries, datname: string): string[] {
  return samplesFor(series, 'cnpg_pg_extensions_update_available')
    .filter(sample => sample.labels.datname === datname && sample.value === 1)
    .map(sample => sample.labels.extname);
}

export interface SeriesRow {
  labels: Record<string, string>;
  values: Record<string, number>;
}

// Joins several metric families into one row per distinct labelKey value (e.g. per replica/slot).
export function groupSeriesByLabel(
  series: PrometheusSeries,
  metricNames: string[],
  labelKey: string
): Map<string, SeriesRow> {
  const rows = new Map<string, SeriesRow>();

  for (const name of metricNames) {
    for (const sample of samplesFor(series, name)) {
      const key = sample.labels[labelKey];
      if (key === undefined) {
        continue;
      }
      let row = rows.get(key);
      if (!row) {
        row = { labels: sample.labels, values: {} };
        rows.set(key, row);
      }
      row.values[name] = sample.value;
    }
  }

  return rows;
}

// pg_size_pretty-style (1024-based) formatting for byte counts the exporter reports raw.
export function formatBytes(bytes: number): string {
  const units = ['bytes', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? String(value) : value.toFixed(2);
  return `${formatted} ${units[unitIndex]}`;
}

// Scrapes the CNPG exporter (port 9187) via the pod-proxy subresource — no psql/exec involved.
export function usePodMetrics(pod: Pod | null, refreshIntervalSeconds = 0): PodMetricsResult {
  const [result, setResult] = useState<PodMetricsResult>({
    loading: true,
    series: null,
    error: null,
  });

  useEffect(() => {
    if (!pod) {
      return;
    }

    let stopped = false;

    function run() {
      setResult(previous => ({ ...previous, loading: true }));

      ApiProxy.request(
        `/api/v1/namespaces/${pod!.getNamespace()}/pods/${pod!.getName()}:9187/proxy/metrics`,
        {
          method: 'GET',
          isJSON: false,
          cluster: pod!.cluster,
        }
      )
        .then((response: Response) => {
          if (stopped) {
            return;
          }
          if (!response.ok) {
            setResult({ loading: false, series: null, error: response.statusText });
            return;
          }
          return response.text().then(text => {
            if (!stopped) {
              setResult({ loading: false, series: parsePrometheusText(text), error: null });
            }
          });
        })
        .catch((error: unknown) => {
          if (!stopped) {
            setResult({
              loading: false,
              series: null,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }

    run();
    const intervalId =
      refreshIntervalSeconds > 0 ? setInterval(run, refreshIntervalSeconds * 1000) : undefined;

    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pod?.metadata.uid, refreshIntervalSeconds]);

  return result;
}
