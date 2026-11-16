import { formatDuration } from '@kinvolk/headlamp-plugin/lib/Utils';

/** How long ago `since` was, e.g. "3h 12m"; undefined if it is missing or unparsable. */
export function formatElapsedSince(since: string | undefined): string | undefined {
  const start = since ? Date.parse(since) : NaN;
  if (Number.isNaN(start)) {
    return undefined;
  }
  return formatDuration(Math.max(Date.now() - start, 0), { format: 'brief' });
}
