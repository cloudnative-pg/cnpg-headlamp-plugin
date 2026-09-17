import { useEffect, useState } from 'react';
import { Pod } from './podActions';

export interface PsqlValueResult {
  loading: boolean;
  output: string;
  error: string | null;
}

const textDecoder = new TextDecoder('utf-8');

// pod.exec() delivers each message as a raw ArrayBuffer: first byte is the channel (1
// stdout, 2 stderr, 3 exit status), rest is payload.
function decodeExecFrame(data: ArrayBuffer): { channel: number; text: string } {
  return { channel: new Uint8Array(data.slice(0, 1))[0], text: textDecoder.decode(data.slice(1)) };
}

function mainContainerName(pod: Pod): string {
  return pod.spec.containers.find(c => c.name === 'postgres')?.name ?? pod.spec.containers[0].name;
}

// Execs `psql -tAc` into the pod's main container, returning trimmed stdout as a plain
// string. refreshIntervalSeconds re-runs the query on a timer; 0 (default) runs it once.
export function usePsqlValue(
  pod: Pod | null,
  database: string,
  query: string,
  refreshIntervalSeconds = 0
): PsqlValueResult {
  const [result, setResult] = useState<PsqlValueResult>({ loading: true, output: '', error: null });

  useEffect(() => {
    if (!pod) {
      return;
    }

    let stopped = false;
    let execHandle: ReturnType<Pod['exec']> | null = null;

    function run() {
      execHandle?.cancel();
      setResult({ loading: true, output: '', error: null });

      let stdout = '';
      let stderr = '';
      let done = false;

      // Channel 3 and failCb can both fire for the same run; only the first counts.
      function finish(fallbackError: string | null) {
        if (done || stopped) {
          return;
        }
        done = true;
        setResult({ loading: false, output: stdout.trim(), error: stderr.trim() || fallbackError });
      }

      execHandle = pod!.exec(
        mainContainerName(pod!),
        data => {
          const { channel, text } = decodeExecFrame(data);
          if (channel === 1) {
            stdout += text;
          } else if (channel === 2) {
            stderr += text;
          } else if (channel === 3) {
            finish(null);
          }
        },
        {
          command: ['psql', '-U', 'postgres', '-d', database, '-X', '-tAc', query],
          tty: false,
          stdin: false,
          reconnectOnFailure: false, // otherwise a closed socket reruns the query forever
          failCb: () => finish('psql exec failed or was closed before finishing'),
        }
      );
    }

    run();
    const intervalId =
      refreshIntervalSeconds > 0 ? setInterval(run, refreshIntervalSeconds * 1000) : undefined;

    return () => {
      stopped = true;
      clearInterval(intervalId);
      execHandle?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pod?.metadata.uid, database, query, refreshIntervalSeconds]);

  return result;
}
