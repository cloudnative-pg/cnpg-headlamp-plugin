import { useTheme } from '@mui/material/styles';
import { LogCategory, SeverityGroup } from '../../../resources/postgresLog';

/**
 * Headlamp's success/error colors are near-white/near-black in dark mode, so explicit light/dark
 * tones are used instead (as in HealthStatusIcon in ../Detail.tsx).
 */
export interface LogColors {
  ok: string;
  warning: string;
  error: string;
  severity: Record<SeverityGroup, string>;
  category: Record<LogCategory, string>;
  role: Record<'primary' | 'replica', string>;
}

export function useLogColors(): LogColors {
  const dark = useTheme().palette.mode === 'dark';
  const pick = (light: string, darkTone: string) => (dark ? darkTone : light);
  const ok = pick('#2e7d32', '#66bb6a');
  const warning = pick('#ed6c02', '#ffa726');
  const error = pick('#c62828', '#ef5350');
  return {
    ok,
    warning,
    error,
    severity: {
      debug: pick('#bdbdbd', '#6b6b6b'),
      // LOG is the ordinary level: neutral grey, so color is kept for what needs attention.
      log: pick('#8a8a8a', '#9a9a9a'),
      notice: pick('#00acc1', '#4dd0e1'),
      warning,
      error,
      fatal: pick('#ad1457', '#f06292'),
    },
    role: { primary: ok, replica: pick('#1976d2', '#64b5f6') },
    category: {
      connections: pick('#9e9d24', '#d4e157'),
      internal: pick('#78909c', '#90a4ae'),
      statements: pick('#fb8c00', '#ffb74d'),
      wal: pick('#1e88e5', '#64b5f6'),
      autovacuum: pick('#00acc1', '#4dd0e1'),
      constraints: pick('#8e24aa', '#ba68c8'),
      locks: pick('#f4511e', '#ff8a65'),
      server: pick('#6d4c41', '#bcaaa4'),
      standby: pick('#3949ab', '#7986cb'),
      errors: error,
      manager: pick('#00897b', '#4db6ac'),
      other: pick('#757575', '#9e9e9e'),
    },
  };
}

export function roleColor(colors: LogColors, role: string | undefined): string {
  return role === 'primary' || role === 'replica' ? colors.role[role] : 'text.secondary';
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

/** "Nov 20 10:17:21.718" in the viewer's local time zone. */
export function formatLogTimestamp(time: number): string {
  const date = new Date(time);
  const base = date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${base}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** "10:17" in the viewer's local time zone. */
export function formatClock(time: number): string {
  return new Date(time).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** A short span such as "45s", "6 min" or "2 h" for bucket widths. */
export function formatSpan(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${minutes} min`;
  }
  return `${Math.round(minutes / 60)} h`;
}
