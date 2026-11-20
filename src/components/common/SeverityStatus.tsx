import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { alpha, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { Severity, StatusInfo } from '../../resources/status';

// Explicit light/dark tones: Headlamp's own success.main is near-white and error.main
// near-black-red in dark mode, so theme palette tokens are unreadable there. These are the MUI
// default hues, picked per mode so both stay legible on light and dark backgrounds.
const TONES: Record<Severity, { light: string; dark: string; icon: string }> = {
  success: { light: '#2e7d32', dark: '#66bb6a', icon: 'mdi:check-circle' },
  info: { light: '#0277bd', dark: '#4fc3f7', icon: 'mdi:progress-clock' },
  warning: { light: '#c25e00', dark: '#ffa726', icon: 'mdi:alert' },
  error: { light: '#c62828', dark: '#ef5350', icon: 'mdi:close-circle' },
  neutral: { light: '#616161', dark: '#bdbdbd', icon: 'mdi:minus-circle-outline' },
};

export function severityColor(theme: Theme, severity: Severity): string {
  return TONES[severity][theme.palette.mode === 'dark' ? 'dark' : 'light'];
}

/** Outlined chip with icon + label (so color is never the only cue) and a reason tooltip. */
export function StatusChip({ status }: { status: StatusInfo }) {
  return (
    <Tooltip title={status.description}>
      <Chip
        size="small"
        variant="outlined"
        label={status.label}
        icon={<Icon icon={TONES[status.severity].icon} width={16} height={16} />}
        sx={{
          color: theme => severityColor(theme, status.severity),
          borderColor: theme => alpha(severityColor(theme, status.severity), 0.6),
          backgroundColor: theme => alpha(severityColor(theme, status.severity), 0.08),
          '& .MuiChip-icon': { color: 'inherit' },
        }}
      />
    </Tooltip>
  );
}

/** Compact icon-only indicator; the tooltip carries the label and the human-readable reason. */
export function StatusIcon({ status, size = 20 }: { status: StatusInfo; size?: number }) {
  return (
    <Tooltip
      title={
        <>
          <strong>{status.label}</strong>
          <br />
          {status.description}
        </>
      }
    >
      <Box
        component="span"
        role="img"
        aria-label={`${status.label}: ${status.description}`}
        sx={{ display: 'inline-flex', color: theme => severityColor(theme, status.severity) }}
      >
        <Icon icon={TONES[status.severity].icon} width={size} height={size} />
      </Box>
    </Tooltip>
  );
}
