import { useEffect, useRef, useState } from 'react';
import {
  POSTGRES_CONTAINER,
  PostgresLogEntry,
  toContainerEntries,
  toPostgresEntries,
} from '../../../resources/postgresLog';
import { Pod } from '../../common/podActions';

const FLUSH_INTERVAL_MS = 1000;

// pod.getLogs appends every chunk to one ever-growing array; parse only the latest chunks so a
// tab left open on a busy primary doesn't get slower with every flush.
const MAX_CHUNKS_PER_POD = 40_000;

export interface ClusterLogsState {
  entries: PostgresLogEntry[];
  fetchedAt: number;
  received: string[];
  /** Pods whose stream ended before delivering anything (e.g. no permission, not running). */
  stopped: string[];
}

const EMPTY: ClusterLogsState = { entries: [], fetchedAt: 0, received: [], stopped: [] };

/**
 * Streams one container's logs (postgres by default) from every instance pod into one list of
 * parsed entries. `live: false` closes the streams but keeps what was collected; changing
 * `tailLines`, `reloadKey` or `container` starts over. Chunks are only buffered by the stream
 * callbacks and parsed once a second, so a chatty primary costs one re-render per second.
 */
export function useClusterPostgresLogs(
  pods: Pod[] | null,
  options: { live: boolean; tailLines: number; reloadKey: number; container: string }
): ClusterLogsState {
  const { live, tailLines, reloadKey, container } = options;
  const [state, setState] = useState<ClusterLogsState>(EMPTY);

  // Keyed on pod UIDs, not the `pods` array, which is re-emitted on every unrelated pod update.
  const podsRef = useRef<Pod[]>([]);
  podsRef.current = pods ?? [];
  const podKey = (pods ?? [])
    .map(pod => pod.metadata.uid)
    .sort()
    .join(',');

  const chunksRef = useRef<Record<string, string[]>>({});
  const parsedRef = useRef<Record<string, PostgresLogEntry[]>>({});
  const dirtyRef = useRef<Set<string>>(new Set());
  const stoppedRef = useRef<Set<string>>(new Set());
  const resetKeyRef = useRef('');

  useEffect(() => {
    const resetKey = `${tailLines}:${reloadKey}:${container}`;
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      chunksRef.current = {};
      parsedRef.current = {};
      dirtyRef.current.clear();
      stoppedRef.current.clear();
      setState(EMPTY);
    }
    if (!live) {
      return;
    }

    const isPostgres = container === POSTGRES_CONTAINER;
    const parse = isPostgres ? toPostgresEntries : toContainerEntries;

    const cancels = podsRef.current.flatMap(pod => {
      const name = pod.metadata.name;
      stoppedRef.current.delete(name);
      const target = [...pod.spec.containers, ...(pod.spec.initContainers ?? [])].find(
        c => c.name === container
      )?.name;
      // Fall back to the first container if a pod somehow lacks postgres.
      const containerName = target ?? (isPostgres ? pod.spec.containers[0]?.name : undefined);
      if (!containerName) {
        return [];
      }
      return [
        pod.getLogs(
          containerName,
          ({ logs }) => {
            // `logs` is the SDK's growing array: keep the reference, parse it at flush time.
            chunksRef.current[name] = logs;
            dirtyRef.current.add(name);
          },
          {
            tailLines,
            follow: true,
            onReconnectStop: () => {
              if (!chunksRef.current[name]) {
                stoppedRef.current.add(name);
                dirtyRef.current.add(name);
              }
            },
          }
        ),
      ];
    });

    const flush = () => {
      const livePods = new Set(podsRef.current.map(pod => pod.metadata.name));
      let removed = false;
      for (const name of Object.keys(parsedRef.current)) {
        if (!livePods.has(name)) {
          delete parsedRef.current[name];
          delete chunksRef.current[name];
          removed = true;
        }
      }
      if (dirtyRef.current.size === 0 && !removed) {
        return;
      }
      for (const name of dirtyRef.current) {
        const chunks = chunksRef.current[name];
        if (chunks) {
          parsedRef.current[name] = parse(
            name,
            chunks.length > MAX_CHUNKS_PER_POD ? chunks.slice(-MAX_CHUNKS_PER_POD) : chunks
          );
        }
      }
      dirtyRef.current.clear();
      setState({
        entries: ([] as PostgresLogEntry[]).concat(...Object.values(parsedRef.current)),
        fetchedAt: Date.now(),
        received: Object.keys(parsedRef.current),
        stopped: [...stoppedRef.current],
      });
    };
    const timer = window.setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      cancels.forEach(cancel => cancel());
    };
  }, [podKey, live, tailLines, reloadKey, container]);

  return state;
}
