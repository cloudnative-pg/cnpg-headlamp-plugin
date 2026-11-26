/** One entry of `klio admin list-backups` JSON output. */
export interface KlioBackupEntry {
  name: string;
  clusterName: string;
  startWal: string;
  endWal: string;
  startLsn?: number;
  endLsn?: number;
  /** Raw multi-line backup label, shown as a tooltip — never as a column. */
  backupLabel?: string;
  tier1: boolean;
  tier2: boolean;
  startedAt?: number;
  stoppedAt?: number;
}

// Annotations look like {"klio.io/tier1": "present"} — the tier is the key's last segment.
function hasTier(annotations: unknown, tier: string): boolean {
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) {
    return false;
  }
  return Object.entries(annotations as Record<string, unknown>).some(([key, value]) => {
    const segment = key.includes('/') ? key.split('/').pop() : key;
    return (
      segment?.toLowerCase() === tier &&
      !!value &&
      String(value).toLowerCase() !== 'absent'
    );
  });
}

/** Parses `klio admin list-backups` stdout. Throws when the output isn't a backup array. */
export function parseListBackups(output: string): KlioBackupEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Output is not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Output is not a backup list.');
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Entry ${index} is not an object.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.clusterName !== 'string') {
      throw new Error(`Entry ${index} has no name/clusterName.`);
    }
    return {
      name: record.name,
      clusterName: record.clusterName,
      startWal: typeof record.startWal === 'string' ? record.startWal : '-',
      endWal: typeof record.endWal === 'string' ? record.endWal : '-',
      ...(typeof record.startLsn === 'number' && { startLsn: record.startLsn }),
      ...(typeof record.endLsn === 'number' && { endLsn: record.endLsn }),
      ...(typeof record.backupLabel === 'string' &&
        record.backupLabel && { backupLabel: record.backupLabel }),
      tier1: hasTier(record.annotations, 'tier1'),
      tier2: hasTier(record.annotations, 'tier2'),
      ...(typeof record.startedAt === 'number' && { startedAt: record.startedAt }),
      ...(typeof record.stoppedAt === 'number' && { stoppedAt: record.stoppedAt }),
    };
  });
}

/** Raw LSN integer to PostgreSQL's `XXXXXXXX/XXXXXXXX` display format (e.g. 0/60345E0). */
export function formatLsn(lsn: number | undefined): string {
  if (typeof lsn !== 'number' || !Number.isFinite(lsn) || lsn < 0) {
    return '-';
  }
  const high = Math.floor(lsn / 0x100000000);
  const low = lsn % 0x100000000;
  return `${high.toString(16).toUpperCase()}/${low.toString(16).toUpperCase()}`;
}

/** Unix seconds (as reported by list-backups) to a locale date-time string. */
export function formatBackupTime(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '-';
  }
  return new Date(seconds * 1000).toLocaleString();
}

/** Elapsed time between start and stop as a short human string (e.g. "1s", "2m 30s",
 *  "1h 5m"). Returns null when the duration can't be determined (still running). */
export function formatBackupDuration(
  startedAt: number | undefined,
  stoppedAt: number | undefined
): string | null {
  if (
    typeof startedAt !== 'number' ||
    typeof stoppedAt !== 'number' ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(stoppedAt) ||
    stoppedAt < startedAt
  ) {
    return null;
  }
  const total = Math.floor(stoppedAt - startedAt);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
