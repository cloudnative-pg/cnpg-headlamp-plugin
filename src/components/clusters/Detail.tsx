import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  ConditionsTable,
  DeleteButton,
  EditButton,
  Loader,
  NameValueTable,
  ResourceLink,
  SectionBox,
  SectionHeader,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Event from '@kinvolk/headlamp-plugin/lib/K8s/event';
import { formatDuration, localeDate } from '@kinvolk/headlamp-plugin/lib/Utils';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { alpha, useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Backup } from '../../resources/backup';
import { Cluster } from '../../resources/cluster';
import { FailoverQuorum } from '../../resources/failoverQuorum';
import { Pooler } from '../../resources/pooler';
import { ScheduledBackup } from '../../resources/scheduledbackup';
import { BackupPhaseLabel } from '../backups/List';
import { Pod, PodPhaseLabel, PodStatusLabel } from '../common/podActions';
import { ViewLogsButton } from '../common/podLogs';
import { OpenTerminalButton } from '../common/podTerminal';
import {
  CHECKPOINTING,
  CNPG_REPLICATION,
  GENERAL_HEALTH,
  groupMetricsByCategory,
  POSTGRES_METRICS,
  PostgresMetric,
} from '../common/postgresMetrics';
import {
  extensionsWithUpdate,
  formatBytes,
  groupSeriesByLabel,
  maxMetric,
  PodMetricsResult,
  PrometheusSeries,
  scalarMetric,
  sumMetric,
  usePodMetrics,
} from '../common/promScrape';
import { PoolerStatusLabel } from '../poolers/List';
import {
  ScheduledBackupScheduleLabel,
  ScheduledBackupSuspendLabel,
} from '../scheduledbackups/List';
import { launchConnectActivity } from './connect';
import { SwitchoverAction } from './switchover';

const { createRouteURL } = Router;

type Pvc = InstanceType<typeof K8s.ResourceClasses.PersistentVolumeClaim>;
type KubeEvent = InstanceType<typeof Event>;
type Lease = InstanceType<typeof K8s.ResourceClasses.Lease>;

function sortByName<T extends { getName(): string }>(items: T[] | null | undefined): T[] {
  return [...(items ?? [])].sort((a, b) => a.getName().localeCompare(b.getName()));
}

/** Formats an ISO timestamp as "Apr 22, 2026, 10:30 AM". */
function formatCreatedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
/** Extracts "17.6" from "ghcr.io/cloudnative-pg/postgresql:17.6". Returns '-' when unknown. */
function parsePostgresVersion(image: string | undefined): string {
  if (!image) {
    return '-';
  }
  const withoutDigest = image.split('@')[0];
  const tag = withoutDigest.split(':').pop() ?? '';
  return tag || '-';
}

/** Parses a Kubernetes quantity ("1Gi", "250Gi", "500Mi", "10G") into bytes. */
function parseQuantityToBytes(quantity: string | undefined): number {
  if (!quantity) {
    return 0;
  }
  const match = quantity.trim().match(/^([0-9.]+)\s*([A-Za-z]*)$/);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  if (Number.isNaN(value)) {
    return 0;
  }
  const unit = match[2];
  const factors: Record<string, number> = {
    '': 1,
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  };
  return value * (factors[unit] ?? 1);
}

function InstanceActions({ cluster, pod }: { cluster: Cluster; pod: Pod }) {
  return (
    <>
      <ViewLogsButton pod={pod} />
      <OpenTerminalButton pod={pod} />
      {pod.getName() !== cluster.currentPrimary && !cluster.isSwitchoverInProgress && (
        <SwitchoverAction cluster={cluster} pod={pod} />
      )}
    </>
  );
}

// Bootstrap job pods (initdb/join/full-recovery/...) don't have a running container to exec
// into once complete, so only logs make sense here — no terminal action.
function JobActions({ pod }: { pod: Pod }) {
  return <ViewLogsButton pod={pod} />;
}

function InstanceRoleLabel({ pod }: { pod: Pod }) {
  const role = pod.metadata.labels?.['cnpg.io/instanceRole'] ?? '-';
  const isReady = pod.status.containerStatuses?.every(container => container.ready) ?? false;

  if (!isReady) {
    return <StatusLabel status="error">{role} (not ready)</StatusLabel>;
  }
  switch (role) {
    case 'primary':
      return <StatusLabel status="success">primary</StatusLabel>;
    case 'replica':
      return <StatusLabel status="">replica</StatusLabel>;
    case 'unhealthy':
      return <StatusLabel status="error">unhealthy</StatusLabel>;
    default:
      return <>{role}</>;
  }
}

// Same name/value look as Headlamp's NameValueTable, but with a wider first column so long
// labels ("Last successful backup", "PostgreSQL Image", ...) stay readable instead of wrapping.
function InfoTable({ rows }: { rows: { name: ReactNode; value: ReactNode }[] }) {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex',
            borderBottom: i < rows.length - 1 ? '1px solid' : 'none',
            borderColor: 'divider',
          }}
        >
          <Box
            component="dt"
            sx={{
              width: '42%',
              flexShrink: 0,
              p: '7px 12px',
              color: 'text.secondary',
              wordBreak: 'break-word',
            }}
          >
            {row.name}
          </Box>
          <Box
            component="dd"
            sx={{ m: 0, flex: 1, minWidth: 0, p: '7px 12px', overflowWrap: 'anywhere' }}
          >
            {row.value}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function CnpgLogo({ size = 18 }: { size?: number }) {
  const theme = useTheme();
  const gradientId = useId();
  // The brand artwork ends in dark navy (#121646), which disappears on Headlamp's dark
  // background — so in dark mode the ink and the dark end of the gradient switch to light
  // tones while the purple head stays untouched.
  const dark = theme.palette.mode === 'dark';
  const ink = dark ? '#e8eaf6' : '#121646';
  const stops = dark
    ? ['#a678ff', '#9a6bf0', '#8a5cf0', '#7c6cf0', '#aab0e0', '#c5cae9']
    : ['#732dd9', '#692aca', '#5024a5', '#291b69', '#121646', '#121646'];
  return (
    <svg
      width={size}
      height={size}
      viewBox="174.83 162.33 729.34 762.84"
      role="img"
      aria-label="CloudNativePG"
    >
      <title>CloudNativePG Icon - Color</title>
      <defs>
        <radialGradient
          id={gradientId}
          cx="-495.01"
          cy="-504.64"
          r="2354.91"
          fx="-495.01"
          fy="-504.64"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={stops[0]} />
          <stop offset=".12" stopColor={stops[1]} />
          <stop offset=".34" stopColor={stops[2]} />
          <stop offset=".65" stopColor={stops[3]} />
          <stop offset=".81" stopColor={stops[4]} />
          <stop offset="1" stopColor={stops[5]} />
        </radialGradient>
        <style>{`.cnpg-logo-fill{fill:url(#${gradientId})}.cnpg-logo-dark{fill:${ink}}`}</style>
      </defs>
      <path
        d="M828.43 842.64c-6.98-16.97-12.13-34.74-17.36-52.38-5.96-20.09-10.89-40.48-16.78-60.59-1.74-5.92-4.69-11.68-8.08-16.86-3.38-5.16-6.87-4.38-8.66 1.45-4.79 15.63-8.88 31.49-14.23 46.92-9.66 27.84-22.83 53.75-40.86 77.44-8.99 11.82-19.06 22.78-29.47 33.35-5.21 5.29-10.51 10.49-15.82 15.68-4.65 4.54-9.53 9.3-6.24 16.19 2.55 5.35 8.22 5.85 13.47 5.83.76 0 1.51-.02 2.24-.03 26.88-.45 53.76.29 80.64.6 18.77.21 37.55.98 56.3.56 7.91-.18 16.6.08 23.04-6.41 7.23-7.29 8.41-12.84 3.19-21.74-7.65-13.04-15.65-26.09-21.37-40z"
        className="cnpg-logo-dark"
      />
      <path
        d="M881.04 620.09c-3.5-.85-6.91-1.79-10.23-2.87-34.42-11-58.21-33.35-84.37-58.52-3.99-3.86-5.3-8.26-5.03-13.78 1.48-25.72-1.62-51.12-6.15-76.34-6.37-35.19-16.92-69.21-31.28-102.01-3.23-7.36-7.54-13.87-9.78-21.68-.22-.85-.4-1.84.18-2.51.63-.76 1.88-.58 2.83-.22 8.35 3.41 21.63 41.16 32.36 31.51 2.29-2.06 3.14-5.21 3.73-8.21 9.11-44.97-2.38-114.26-42.55-142.09-18.45-12.79-38.69-25.22-60.81-30.2-11.31-2.51-23.61-2.38-34.02 2.74-5.16 2.51-9.83 6.24-15.44 7.58-10.01 2.47-19.97-3.14-29.85-6.15-11.98-3.59-25.04-3.41-36.89.58-9.51 3.19-19.03 8.84-28.9 7-13.69-2.56-23.56-18.36-37.74-23.2-17.01-5.83-35.9-5.83-53.32-1.93-50 11.22-96.94 46.32-131.9 82.44-38.37 39.63-53.63 92.05-19.7 139.89 12.12 17.1 29.93 30.43 50.26 35.68 3.95 1.03 8.12 1.84 11.4 4.26 12.93 9.6-14.36 35.32-20.2 43.67-12.57 18.09-24.28 36.85-32.99 57.13-16.16 37.56-23.2 75.35-28.86 115.57-9.78 69.56-22.89 141.06-55.43 203.89-5.25 10.1-11.8 20.15-15.93 30.74-.99 2.51-1.3 5.47 0 7.81.76 1.35 2.02 2.38 3.37 3.1 7.27 4.04 18.31 3.14 26.34 3.19 24.23.09 48.47.18 72.75.22 12.34.04 24.68.09 37.03.09 8.89 0 21.95 2.24 30.03-2.02 5.21-2.74 8.08-8.57 9.51-14.32 2.11-8.44 3.46-17.1 5.7-25.54 6.91-25.81 16.74-50.35 29.35-73.96 20.02-37.47 40.93-79.84 3.77-114.04-9.78-8.98-21.05-16.11-31.55-24.19-2.02-1.57-3.99-4.76-1.88-6.19.81-.58 1.93-.45 2.96-.22 40.53 8.48 78 52.01 75.49 93.71-1.35 21.77-10.1 41.29-16.74 61.48-6.73 20.51-14.63 40.8-16.52 62.61-.76 8.62-1.66 17.32-1.75 25.99-.13 11.22 4.08 17.01 16.83 17.05 46.63.09 93.26.81 139.89 1.26 11.85.13 36.17 4.04 40.93-11.26 1.75-5.65-.49-11.71-3.41-16.83-2.92-5.12-6.64-9.92-8.21-15.62-2.87-10.19 1.62-20.91 6.37-30.38 5.52-10.95 12.39-21.23 17.86-32.18 6.42-11.58 13.96-22.35 19.75-34.33 6.1-12.52 11.04-25.58 15.12-38.87 5.52-17.82 9.51-36.08 12.66-54.44.67-3.98 1.11-7.99 1.58-11.99.24-2.01.49-4.03.78-6.03.33-2.25.82-4.92 3.74-4.71 17.4 1.23-8.72 100.8-10.99 106.88-5.34 14.27-11.76 28.14-19.3 41.42-9.47 16.65-26.88 31.78-22.62 52.82 1.53 7.45 3.32 18.13 10.05 22.84 9.24 6.51 21.14-4.31 27.69-10.19 10.32-9.29 18.62-20.37 27.33-31.15 23.97-29.62 42.41-63.33 55.83-98.91 14.59-38.87 21.09-77.51 26.21-118.44.31-2.33.81-4.98 2.78-6.24 2.24-1.44 5.16-.36 7.58.72 29.62 13.1 61.62 23.7 93.84 20.6 3.95-.4 8.89-2.06 8.98-6.01.09-3.91-4.71-5.79-8.53-6.69zm-157.57-20.24c-.31 1.12-1.17 2.11-2.15 2.74-1.89 1.17-4.4 1.48-6.55 1.71-14.36 1.48-28.5-2.92-41.42-8.75-2.06-.9-4.13-1.84-6.19-2.87-19.7-9.78-38.01-23.74-53.14-39.72-12.84-13.55-22.98-29.62-29.93-46.94-1.48-3.68-3.23-7.63-4.08-11.53-.72-3.32-.27-7.23 2.29-9.52 1.62-1.44 3.81-1.97 5.92-2.42 7.05-1.39 14.54-2.15 21.68-1.53 2.92.18 5.97.94 8.03 2.96 1.84 1.75 2.74 4.22 3.55 6.64 3.5 10.5 6.42 21.32 11.4 31.28 5.03 10.1 11.67 19.57 18.58 28.45 2.51 3.23 5.12 6.37 7.81 9.47 13.33 15.3 30.83 28.99 51.3 32.9.81.18 1.62.31 2.47.45 2.83.4 5.79.67 8.21 2.24 1.17.76 2.2 1.98 2.33 3.37 0 .36 0 .72-.09 1.08z"
        className="cnpg-logo-dark"
      />
      <g>
        <path
          d="M828.43 842.64c-6.98-16.97-12.13-34.74-17.36-52.38-5.96-20.09-10.89-40.48-16.78-60.59-1.74-5.92-4.69-11.68-8.08-16.86-3.38-5.16-6.87-4.38-8.66 1.45-4.79 15.63-8.88 31.49-14.23 46.92-9.66 27.84-22.83 53.75-40.86 77.44-8.99 11.82-19.06 22.78-29.47 33.35-5.21 5.29-10.51 10.49-15.82 15.68-4.65 4.54-9.53 9.3-6.24 16.19 2.55 5.35 8.22 5.85 13.47 5.83.76 0 1.51-.02 2.24-.03 26.88-.45 53.76.29 80.64.6 18.77.21 37.55.98 56.3.56 7.91-.18 16.6.08 23.04-6.41 7.23-7.29 8.41-12.84 3.19-21.74-7.65-13.04-15.65-26.09-21.37-40z"
          className="cnpg-logo-fill"
        />
        <path
          d="M881.04 620.09c-3.5-.85-6.91-1.79-10.23-2.87-34.42-11-58.21-33.35-84.37-58.52-3.99-3.86-5.3-8.26-5.03-13.78 1.48-25.72-1.62-51.12-6.15-76.34-6.37-35.19-16.92-69.21-31.28-102.01-3.23-7.36-7.54-13.87-9.78-21.68-.22-.85-.4-1.84.18-2.51.63-.76 1.88-.58 2.83-.22 8.35 3.41 21.63 41.16 32.36 31.51 2.29-2.06 3.14-5.21 3.73-8.21 9.11-44.97-2.38-114.26-42.55-142.09-18.45-12.79-38.69-25.22-60.81-30.2-11.31-2.51-23.61-2.38-34.02 2.74-5.16 2.51-9.83 6.24-15.44 7.58-10.01 2.47-19.97-3.14-29.85-6.15-11.98-3.59-25.04-3.41-36.89.58-9.51 3.19-19.03 8.84-28.9 7-13.69-2.56-23.56-18.36-37.74-23.2-17.01-5.83-35.9-5.83-53.32-1.93-50 11.22-96.94 46.32-131.9 82.44-38.37 39.63-53.63 92.05-19.7 139.89 12.12 17.1 29.93 30.43 50.26 35.68 3.95 1.03 8.12 1.84 11.4 4.26 12.93 9.6-14.36 35.32-20.2 43.67-12.57 18.09-24.28 36.85-32.99 57.13-16.16 37.56-23.2 75.35-28.86 115.57-9.78 69.56-22.89 141.06-55.43 203.89-5.25 10.1-11.8 20.15-15.93 30.74-.99 2.51-1.3 5.47 0 7.81.76 1.35 2.02 2.38 3.37 3.1 7.27 4.04 18.31 3.14 26.34 3.19 24.23.09 48.47.18 72.75.22 12.34.04 24.68.09 37.03.09 8.89 0 21.95 2.24 30.03-2.02 5.21-2.74 8.08-8.57 9.51-14.32 2.11-8.44 3.46-17.1 5.7-25.54 6.91-25.81 16.74-50.35 29.35-73.96 20.02-37.47 40.93-79.84 3.77-114.04-9.78-8.98-21.05-16.11-31.55-24.19-2.02-1.57-3.99-4.76-1.88-6.19.81-.58 1.93-.45 2.96-.22 40.53 8.48 78 52.01 75.49 93.71-1.35 21.77-10.1 41.29-16.74 61.48-6.73 20.51-14.63 40.8-16.52 62.61-.76 8.62-1.66 17.32-1.75 25.99-.13 11.22 4.08 17.01 16.83 17.05 46.63.09 93.26.81 139.89 1.26 11.85.13 36.17 4.04 40.93-11.26 1.75-5.65-.49-11.71-3.41-16.83-2.92-5.12-6.64-9.92-8.21-15.62-2.87-10.19 1.62-20.91 6.37-30.38 5.52-10.95 12.39-21.23 17.86-32.18 6.42-11.58 13.96-22.35 19.75-34.33 6.1-12.52 11.04-25.58 15.12-38.87 5.52-17.82 9.51-36.08 12.66-54.44.67-3.98 1.11-7.99 1.58-11.99.24-2.01.49-4.03.78-6.03.33-2.25.82-4.92 3.74-4.71 17.4 1.23-8.72 100.8-10.99 106.88-5.34 14.27-11.76 28.14-19.3 41.42-9.47 16.65-26.88 31.78-22.62 52.82 1.53 7.45 3.32 18.13 10.05 22.84 9.24 6.51 21.14-4.31 27.69-10.19 10.32-9.29 18.62-20.37 27.33-31.15 23.97-29.62 42.41-63.33 55.83-98.91 14.59-38.87 21.09-77.51 26.21-118.44.31-2.33.81-4.98 2.78-6.24 2.24-1.44 5.16-.36 7.58.72 29.62 13.1 61.62 23.7 93.84 20.6 3.95-.4 8.89-2.06 8.98-6.01.09-3.91-4.71-5.79-8.53-6.69zm-157.57-20.24c-.31 1.12-1.17 2.11-2.15 2.74-1.89 1.17-4.4 1.48-6.55 1.71-14.36 1.48-28.5-2.92-41.42-8.75-2.06-.9-4.13-1.84-6.19-2.87-19.7-9.78-38.01-23.74-53.14-39.72-12.84-13.55-22.98-29.62-29.93-46.94-1.48-3.68-3.23-7.63-4.08-11.53-.72-3.32-.27-7.23 2.29-9.52 1.62-1.44 3.81-1.97 5.92-2.42 7.05-1.39 14.54-2.15 21.68-1.53 2.92.18 5.97.94 8.03 2.96 1.84 1.75 2.74 4.22 3.55 6.64 3.5 10.5 6.42 21.32 11.4 31.28 5.03 10.1 11.67 19.57 18.58 28.45 2.51 3.23 5.12 6.37 7.81 9.47 13.33 15.3 30.83 28.99 51.3 32.9.81.18 1.62.31 2.47.45 2.83.4 5.79.67 8.21 2.24 1.17.76 2.2 1.98 2.33 3.37 0 .36 0 .72-.09 1.08z"
          className="cnpg-logo-fill"
        />
      </g>
    </svg>
  );
}

function StatCard({
  icon,
  title,
  value,
  bareIcon,
}: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  bareIcon?: boolean;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent
        sx={{
          display: 'flex',
          gap: 1,
          alignItems: 'center',
          py: 1,
          px: 1.5,
          '&:last-child': { pb: 1 },
        }}
      >
        {bareIcon ? (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</Box>
        ) : (
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'action.hover',
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography
            variant="body1"
            sx={{ fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {value}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

// Green check / red cross used for health-style statuses. Headlamp's own success.main is
// near-white and error.main near-black-red in dark mode, so both would be unreadable there —
// these explicit tones stay legible on light and dark backgrounds alike.
function HealthStatusIcon({
  healthy,
  size = 20,
  title,
}: {
  healthy: boolean;
  size?: number;
  title: string;
}) {
  return (
    <Tooltip title={title}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          color: theme =>
            healthy
              ? theme.palette.mode === 'dark'
                ? '#66bb6a'
                : '#2e7d32'
              : theme.palette.mode === 'dark'
              ? '#ef5350'
              : '#c62828',
        }}
      >
        <Icon icon={healthy ? 'mdi:check-circle' : 'mdi:close-circle'} width={size} height={size} />
      </Box>
    </Tooltip>
  );
}

function SummaryStrip({ cluster }: { cluster: Cluster }) {
  const [pvcs] = K8s.ResourceClasses.PersistentVolumeClaim.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()}`,
  });

  const storageValue = useMemo(() => {
    if (pvcs && pvcs.length > 0) {
      const totalBytes = pvcs.reduce(
        (total, pvc) =>
          total +
          parseQuantityToBytes(
            pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage
          ),
        0
      );
      if (totalBytes > 0) {
        return formatBytes(totalBytes);
      }
    }
    const perInstance = cluster.spec.storage?.size;
    if (perInstance) {
      const totalBytes = parseQuantityToBytes(perInstance) * Math.max(cluster.instances, 1);
      if (totalBytes > 0) {
        return formatBytes(totalBytes);
      }
      return perInstance;
    }
    return '-';
  }, [pvcs, cluster]);

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6} md={4} lg={2.4}>
        <StatCard
          icon={<Icon icon="mdi:hexagon-multiple-outline" width={18} height={18} />}
          title="Health"
          value={
            <HealthStatusIcon
              healthy={cluster.health === 'success'}
              size={22}
              title={cluster.healthLabel}
            />
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={2.4}>
        <StatCard
          icon={<CnpgLogo size={24} />}
          title="PostgreSQL"
          value={parsePostgresVersion(cluster.image ?? cluster.spec.imageName)}
          bareIcon
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={2.4}>
        <StatCard
          icon={<Icon icon="mdi:server-outline" width={18} height={18} />}
          title="Instances"
          value={`${cluster.readyInstances} / ${cluster.instances} Ready`}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={2.4}>
        <StatCard
          icon={<Icon icon="mdi:crown-outline" width={18} height={18} />}
          title="Primary"
          value={cluster.currentPrimary ?? '-'}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={2.4}>
        <StatCard
          icon={<Icon icon="mdi:harddisk" width={18} height={18} />}
          title="Storage"
          value={storageValue}
        />
      </Grid>
    </Grid>
  );
}

function InstanceNode({ pod, emphasis }: { pod: Pod; emphasis: 'primary' | 'standby' }) {
  const isReady =
    pod.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True') ?? false;
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: emphasis === 'primary' ? 'success.main' : 'divider',
        borderRadius: 2,
        p: 1.5,
        minWidth: 140,
        maxWidth: 220,
        flex: 1,
        bgcolor: theme => {
          const green = theme.palette.mode === 'dark' ? '#66bb6a' : '#2e7d32';
          return emphasis === 'primary'
            ? alpha(green, theme.palette.mode === 'dark' ? 0.16 : 0.1)
            : alpha(theme.palette.grey[500], theme.palette.mode === 'dark' ? 0.18 : 0.12);
        },
        textAlign: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        {emphasis === 'primary' ? 'Primary' : 'Standby'}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
        <ResourceLink resource={pod} />
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          mt: 0.5,
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: theme =>
              isReady ? (theme.palette.mode === 'dark' ? '#66bb6a' : '#2e7d32') : 'warning.main',
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {isReady ? 'Ready' : pod.status.phase ?? 'Not ready'}
        </Typography>
      </Box>
      <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'center', gap: 0.5 }}>
        <ViewLogsButton pod={pod} />
        <OpenTerminalButton pod={pod} />
      </Box>
    </Box>
  );
}

function ClusterTopology({ cluster }: { cluster: Cluster }) {
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });

  const sorted = useMemo(() => sortByName(pods), [pods]);
  const primaryName = cluster.currentPrimary;
  const primary = sorted.find(pod => pod.getName() === primaryName) ?? null;
  const standbys = sorted.filter(pod => pod.getName() !== primary?.getName());

  return (
    <SectionBox title="Cluster Topology" headerProps={{ titleSideActions: [] }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        PostgreSQL instances and replication status
      </Typography>
      {!pods ? (
        <Typography variant="body2" color="text.secondary">
          Loading instances…
        </Typography>
      ) : sorted.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No instance pods found yet.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          {primary && <InstanceNode key={primary.getName()} pod={primary} emphasis="primary" />}
          {standbys.length > 0 && (
            <>
              <Box
                sx={{
                  width: 2,
                  height: 16,
                  bgcolor: 'divider',
                }}
              />
              <Box
                sx={{
                  display: 'flex',
                  gap: 2,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  width: '100%',
                }}
              >
                {standbys.map(pod => (
                  <InstanceNode key={pod.getName()} pod={pod} emphasis="standby" />
                ))}
              </Box>
            </>
          )}
        </Box>
      )}
    </SectionBox>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const theme = useTheme();
  const width = 120;
  const height = 36;
  if (points.length === 0) {
    return <Box sx={{ width: '100%', height }} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map(
    (p, i) =>
      `${(i * step).toFixed(1)},${(height - 3 - ((p - min) / span) * (height - 6)).toFixed(1)}`
  );
  // A single sample has no trend yet — draw it as a flat dotted line.
  const line =
    points.length === 1
      ? `0,${coords[0].split(',')[1]} ${width},${coords[0].split(',')[1]}`
      : coords.join(' ');
  const color = theme.palette.primary.main;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={color} opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={points.length === 1 ? '3 3' : undefined}
      />
    </svg>
  );
}

function PerformanceTile({
  title,
  value,
  caption,
  info,
  history,
}: {
  title: string;
  value: string;
  caption: string;
  info: ReactNode;
  history: number[];
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        height: '100%',
      }}
    >
      <Tooltip title={info}>
        <span style={{ position: 'absolute', top: 4, right: 4, display: 'flex' }}>
          <Icon icon="mdi:information-outline" width={14} height={14} />
        </span>
      </Tooltip>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, pr: 2 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mt: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Sparkline points={history} />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {caption}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function PerformanceOverview({ cluster }: { cluster: Cluster }) {
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });
  const [refreshSeconds, setRefreshSeconds] = useState(15);
  const primaryPod = pods?.find(pod => pod.getName() === cluster.currentPrimary) ?? null;
  const result = usePodMetrics(primaryPod, refreshSeconds);

  const stats = useMemo(() => {
    if (!result.series) {
      return null;
    }
    const activeConnections = sumMetric(result.series, 'cnpg_backends_total', {
      label: 'usename',
      values: ['streaming_replica', 'cnpg_metrics_exporter'],
    });
    const maxConnections = scalarMetric(result.series, 'cnpg_pg_settings_max_connections');
    const hit = sumMetric(result.series, 'cnpg_pg_stat_database_blks_hit');
    const read = sumMetric(result.series, 'cnpg_pg_stat_database_blks_read');
    const cacheHit = hit + read === 0 ? 0 : (hit * 100) / (hit + read);
    const lagBytes = maxMetric(result.series, 'cnpg_pg_stat_replication_replay_diff_bytes');
    const dbSize = sumMetric(result.series, 'cnpg_pg_database_size_bytes');
    return { activeConnections, maxConnections, cacheHit, lagBytes, dbSize };
  }, [result.series]);

  // Accumulates one sample per successful scrape so each tile can draw a live trend
  // sparkline, screenshot-style. Capped so an always-open page can't grow unbounded.
  const [history, setHistory] = useState<{
    connections: number[];
    cacheHit: number[];
    lag: number[];
    size: number[];
  }>({ connections: [], cacheHit: [], lag: [], size: [] });

  useEffect(() => {
    if (!stats) {
      return;
    }
    setHistory(prev => ({
      connections: [...prev.connections, stats.activeConnections].slice(-24),
      cacheHit: [...prev.cacheHit, stats.cacheHit].slice(-24),
      lag: [...prev.lag, stats.lagBytes].slice(-24),
      size: [...prev.size, stats.dbSize].slice(-24),
    }));
  }, [stats]);

  return (
    <SectionBox
      title="Performance"
      headerProps={{
        titleSideActions: [],
        actions: [
          <Select
            key="refresh-interval"
            size="small"
            value={refreshSeconds}
            onChange={e => setRefreshSeconds(Number(e.target.value))}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value={0}>Last 1 hour</MenuItem>
            <MenuItem value={1}>Refresh 1s</MenuItem>
            <MenuItem value={5}>Refresh 5s</MenuItem>
            <MenuItem value={15}>Refresh 15s</MenuItem>
            <MenuItem value={30}>Refresh 30s</MenuItem>
            <MenuItem value={60}>Refresh 60s</MenuItem>
          </Select>,
        ],
      }}
    >
      {result.loading && !result.series ? (
        <Typography variant="body2" color="text.secondary">
          Loading live metrics from primary…
        </Typography>
      ) : result.error ? (
        <Typography variant="body2" color="error">
          Metrics unavailable: {result.error}
        </Typography>
      ) : stats ? (
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <PerformanceTile
              title="Connections"
              value={`${stats.activeConnections}`}
              caption={
                stats.maxConnections > 0
                  ? `active of ${stats.maxConnections} max`
                  : 'active backends'
              }
              info={
                <Box sx={{ maxWidth: 240 }}>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    Client backend connections, excluding replication connections and the metrics
                    exporter&apos;s own probe connection.
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 1,
                      fontFamily: 'monospace',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    [cnpg_backends_total]
                  </Box>
                </Box>
              }
              history={history.connections}
            />
          </Grid>
          <Grid item xs={6}>
            <PerformanceTile
              title="Cache Hit"
              value={`${stats.cacheHit.toFixed(1)}%`}
              caption="of reads from cache"
              info={
                <Box sx={{ maxWidth: 240 }}>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    Share of block reads served from shared buffers.
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 1,
                      fontFamily: 'monospace',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    [cnpg_pg_stat_database_blks_hit, cnpg_pg_stat_database_blks_read]
                  </Box>
                </Box>
              }
              history={history.cacheHit}
            />
          </Grid>
          <Grid item xs={6}>
            <PerformanceTile
              title="Repl. Lag"
              value={formatBytes(stats.lagBytes)}
              caption="max WAL replay lag"
              info={
                <Box sx={{ maxWidth: 240 }}>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    Maximum difference, in bytes, between the current WAL location and the WAL
                    location replayed by a standby.
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 1,
                      fontFamily: 'monospace',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    [cnpg_pg_stat_replication_replay_diff_bytes]
                  </Box>
                </Box>
              }
              history={history.lag}
            />
          </Grid>
          <Grid item xs={6}>
            <PerformanceTile
              title="DB Size"
              value={formatBytes(stats.dbSize)}
              caption="across all databases"
              info={
                <Box sx={{ maxWidth: 240 }}>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    Combined on-disk size of every database in the instance.
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 1,
                      fontFamily: 'monospace',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    [cnpg_pg_database_size_bytes]
                  </Box>
                </Box>
              }
              history={history.size}
            />
          </Grid>
        </Grid>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No metrics reported yet.
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Live from primary {primaryPod?.getName() ?? '-'} exporter (:9187).
      </Typography>
    </SectionBox>
  );
}

function BackupStatusCard({ cluster }: { cluster: Cluster }) {
  const history = useHistory();
  const [backups] = Backup.useList({ namespace: cluster.getNamespace() });
  const [scheduled] = ScheduledBackup.useList({ namespace: cluster.getNamespace() });

  const clusterBackups = useMemo(
    () => (backups ?? []).filter(b => b.clusterName === cluster.getName()),
    [backups, cluster]
  );
  const completed = useMemo(
    () =>
      clusterBackups
        .filter(b => b.phase === 'completed' && b.stoppedAt)
        .sort((a, b) => (b.stoppedAt ?? '').localeCompare(a.stoppedAt ?? '')),
    [clusterBackups]
  );
  const lastSuccessful = completed[0];
  const clusterSchedules = useMemo(
    () => (scheduled ?? []).filter(s => s.clusterName === cluster.getName() && !s.suspend),
    [scheduled, cluster]
  );
  const nextScheduled = useMemo(
    () =>
      clusterSchedules
        .filter(s => s.nextScheduleTime)
        .sort((a, b) => (a.nextScheduleTime ?? '').localeCompare(b.nextScheduleTime ?? ''))[0],
    [clusterSchedules]
  );
  const backupLocation =
    cluster.spec.plugins?.find(p => p.parameters?.barmanObjectName)?.parameters?.barmanObjectName ??
    cluster.spec.backup?.volumeSnapshot?.className ??
    '-';

  const healthy = cluster.isLastBackupSucceeded !== false;

  return (
    <SectionBox
      title={
        <SectionHeader
          headerStyle="subsection"
          title={
            <>
              <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle', mr: 1 }}>
                <HealthStatusIcon
                  healthy={cluster.health === 'success'}
                  size={20}
                  title={cluster.healthLabel}
                />
              </Box>
              Backup Status
            </>
          }
        />
      }
    >
      <InfoTable
        rows={[
          {
            name: 'Last successful backup',
            value: lastSuccessful?.stoppedAt ? localeDate(lastSuccessful.stoppedAt) : 'None yet',
          },
          {
            name: 'Next scheduled backup',
            value: nextScheduled?.nextScheduleTime
              ? localeDate(nextScheduled.nextScheduleTime)
              : 'Not scheduled',
          },
          { name: 'Backup location', value: backupLocation },
        ]}
      />
      {!healthy && (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
          Last backup did not succeed — check the Backups tab.
        </Typography>
      )}
      <Box sx={{ mt: 2 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Icon icon="mdi:backup-restore" />}
          onClick={() =>
            history.push(
              `${createRouteURL(
                'CNPG Backups'
              )}?cluster=${cluster.getName()}&namespace=${cluster.getNamespace()}`
            )
          }
        >
          View Backups
        </Button>
      </Box>
    </SectionBox>
  );
}

function ClusterInfoCard({ cluster, lease }: { cluster: Cluster; lease: Lease | null }) {
  const labels = cluster.jsonData.metadata?.labels ?? {};
  const annotations = cluster.jsonData.metadata?.annotations ?? {};
  const created = cluster.jsonData.metadata?.creationTimestamp;
  const spec = lease?.spec as
    | (Lease['spec'] & { acquireTime?: string; holderIdentity?: string })
    | undefined;

  return (
    <SectionBox title="Cluster Information">
      <InfoTable
        rows={[
          { name: 'Name', value: cluster.getName() },
          { name: 'Namespace', value: cluster.getNamespace() },
          {
            name: 'Labels',
            value:
              Object.keys(labels).length > 0
                ? Object.entries(labels)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ')
                : '-',
          },
          {
            name: 'Annotations',
            value:
              Object.keys(annotations).length > 0
                ? Object.entries(annotations)
                    .slice(0, 3)
                    .map(([k]) => k)
                    .join(', ') + (Object.keys(annotations).length > 3 ? '…' : '')
                : '-',
          },
          { name: 'PostgreSQL Image', value: cluster.image ?? cluster.spec.imageName ?? '-' },
          { name: 'Timeline', value: cluster.timelineID ?? '-' },
          { name: 'Primary', value: cluster.currentPrimary ?? '-' },
          {
            name: 'Lease Holder',
            value: spec?.holderIdentity ?? '-',
          },
          { name: 'Created', value: created ? localeDate(created) : cluster.getAge() },
          {
            name: 'Last Updated',
            value: spec?.renewTime ? localeDate(spec.renewTime) : '-',
          },
        ]}
      />
    </SectionBox>
  );
}

function RecentEventsCard({ cluster, onViewAll }: { cluster: Cluster; onViewAll?: () => void }) {
  const [events] = Event.useList({
    namespace: cluster.getNamespace(),
  });

  const rows = useMemo(() => {
    const prefix = `${cluster.getName()}-`;
    const relevant = (events ?? []).filter(event => {
      const involvedName = event.jsonData.involvedObject?.name ?? event.involvedObject?.name ?? '';
      return involvedName === cluster.getName() || involvedName.startsWith(prefix);
    });
    const eventTime = (event: KubeEvent) =>
      event.jsonData.lastTimestamp ??
      event.jsonData.eventTime ??
      event.lastOccurrence ??
      event.metadata.creationTimestamp ??
      '';
    return relevant.sort((a, b) => eventTime(b).localeCompare(eventTime(a))).slice(0, 5);
  }, [events, cluster]);

  return (
    <SectionBox title="Recent Events">
      <SimpleTable
        columns={[
          {
            label: 'Time',
            getter: (event: KubeEvent) =>
              localeDate(
                event.jsonData.lastTimestamp ??
                  event.jsonData.eventTime ??
                  event.lastOccurrence ??
                  event.metadata.creationTimestamp ??
                  ''
              ),
          },
          {
            label: 'Type',
            getter: (event: KubeEvent) => (
              <StatusLabel
                status={
                  event.type === 'Warning' ? 'warning' : event.type === 'Normal' ? 'success' : ''
                }
              >
                {event.type}
              </StatusLabel>
            ),
          },
          { label: 'Reason', getter: (event: KubeEvent) => event.reason },
          {
            label: 'Message',
            getter: (event: KubeEvent) => (
              <span title={event.message}>
                {event.message.length > 80 ? `${event.message.slice(0, 80)}…` : event.message}
              </span>
            ),
          },
        ]}
        data={rows}
        emptyMessage="No events yet"
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Showing {rows.length} of {(events ?? []).length} events
        </Typography>
        {onViewAll && (
          <Button size="small" onClick={onViewAll}>
            View all events →
          </Button>
        )}
      </Box>
    </SectionBox>
  );
}

function OverviewTab({ cluster, lease }: { cluster: Cluster; lease: Lease | null }) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={6}>
        <ClusterTopology cluster={cluster} />
      </Grid>
      <Grid item xs={12} md={6}>
        <PerformanceOverview cluster={cluster} />
      </Grid>
      <Grid item xs={12} md={6}>
        <ClusterInfoCard cluster={cluster} lease={lease} />
      </Grid>
      <Grid item xs={12} md={6}>
        <BackupStatusCard cluster={cluster} />
      </Grid>
    </Grid>
  );
}

function MetricTile({ result, metric }: { result: PodMetricsResult; metric: PostgresMetric }) {
  const value = result.series ? metric.compute(result.series) : '';

  return (
    <Box
      sx={{
        position: 'relative',
        width: 140,
        height: 140,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        p: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        textAlign: 'center',
      }}
    >
      <Tooltip
        title={
          <Box sx={{ maxWidth: 240 }}>
            <Typography variant="caption" sx={{ display: 'block' }}>
              {metric.description}
            </Typography>
            <Box
              component="pre"
              sx={{ m: 0, mt: 1, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}
            >
              [{metric.metricNames.join(', ')}]
            </Box>
          </Box>
        }
      >
        <span style={{ position: 'absolute', top: 4, right: 4, display: 'flex' }}>
          <Icon icon="mdi:information-outline" width={14} height={14} />
        </span>
      </Tooltip>
      {result.loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : result.error ? (
        <Tooltip title={result.error}>
          <span>
            <StatusLabel status="error">Error</StatusLabel>
          </span>
        </Tooltip>
      ) : (
        <Typography variant="h6" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
          {value || '0'}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {metric.label}
        {metric.primaryOnly && ' (primary)'}
      </Typography>
    </Box>
  );
}

function MetricAccordion({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Accordion
      variant="outlined"
      defaultExpanded
      disableGutters
      sx={{ mb: 2, '&:last-child': { mb: 0 }, borderRadius: 1, '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
          {subtitle && (
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              sx={{ ml: 1, fontWeight: 400 }}
            >
              ({subtitle})
            </Typography>
          )}
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

function MetricTileGrid({
  metrics,
  result,
}: {
  metrics: [string, PostgresMetric][];
  result: PodMetricsResult;
}) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {metrics.map(([id, metric]) => (
        <MetricTile key={id} result={result} metric={metric} />
      ))}
    </Box>
  );
}

function StandbysTable({ series }: { series: PrometheusSeries | null }) {
  const rows = series
    ? [
        ...groupSeriesByLabel(
          series,
          [
            'cnpg_pg_stat_replication_write_diff_bytes',
            'cnpg_pg_stat_replication_flush_diff_bytes',
            'cnpg_pg_stat_replication_replay_diff_bytes',
            'cnpg_pg_stat_replication_backend_start',
          ],
          'application_name'
        ).entries(),
      ]
    : [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Standby', getter: ([name]: [string, unknown]) => name },
        {
          label: 'Write Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_stat_replication_write_diff_bytes'] ?? 0),
        },
        {
          label: 'Flush Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_stat_replication_flush_diff_bytes'] ?? 0),
        },
        {
          label: 'Replay Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_stat_replication_replay_diff_bytes'] ?? 0),
        },
        {
          label: 'Connected For',
          getter: ([, row]: [string, { values: Record<string, number> }]) => {
            const start = row.values['cnpg_pg_stat_replication_backend_start'];
            return start ? formatDuration(Date.now() - start * 1000, { format: 'brief' }) : '-';
          },
        },
      ]}
      data={rows}
    />
  );
}

function ReplicationSlotsTable({ series }: { series: PrometheusSeries | null }) {
  const rows = series
    ? [
        ...groupSeriesByLabel(
          series,
          ['cnpg_pg_replication_slots_active', 'cnpg_pg_replication_slots_pg_wal_lsn_diff'],
          'slot_name'
        ).entries(),
      ]
    : [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Slot Name', getter: ([name]: [string, unknown]) => name },
        {
          label: 'Type',
          getter: ([, row]: [string, { labels: Record<string, string> }]) =>
            row.labels.slot_type ?? '-',
        },
        {
          label: 'Active',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            row.values['cnpg_pg_replication_slots_active'] ? 'Yes' : 'No',
        },
        {
          label: 'Lag',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            formatBytes(row.values['cnpg_pg_replication_slots_pg_wal_lsn_diff'] ?? 0),
        },
      ]}
      data={rows}
    />
  );
}

// datname="" is an aggregate/shared-catalog row, not a real database; template0 is frozen and
// never connectable — neither belongs in a per-database table.
const NON_DATABASE_DATNAMES = new Set(['', 'template0']);

function DatabaseHealthTable({ series }: { series: PrometheusSeries | null }) {
  const rows = series
    ? [
        ...groupSeriesByLabel(
          series,
          [
            'cnpg_pg_database_xid_age',
            'cnpg_pg_database_mxid_age',
            'cnpg_pg_stat_database_xact_commit',
            'cnpg_pg_stat_database_xact_rollback',
            'cnpg_pg_stat_database_temp_files',
            'cnpg_pg_stat_database_temp_bytes',
          ],
          'datname'
        ).entries(),
      ].filter(([name]) => !NON_DATABASE_DATNAMES.has(name))
    : [];
  if (rows.length === 0) {
    return null;
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Database', getter: ([name]: [string, unknown]) => name },
        {
          label: 'Transaction ID Age',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            String(row.values['cnpg_pg_database_xid_age'] ?? 0),
        },
        {
          label: 'Multixact ID Age',
          getter: ([, row]: [string, { values: Record<string, number> }]) =>
            String(row.values['cnpg_pg_database_mxid_age'] ?? 0),
        },
        {
          label: 'Rollback Ratio (%)',
          getter: ([, row]: [string, { values: Record<string, number> }]) => {
            const commit = row.values['cnpg_pg_stat_database_xact_commit'] ?? 0;
            const rollback = row.values['cnpg_pg_stat_database_xact_rollback'] ?? 0;
            return commit + rollback === 0
              ? '0'
              : ((rollback * 100) / (commit + rollback)).toFixed(2);
          },
        },
        {
          label: 'Temp File Spill',
          getter: ([, row]: [string, { values: Record<string, number> }]) => {
            const files = row.values['cnpg_pg_stat_database_temp_files'] ?? 0;
            const bytes = row.values['cnpg_pg_stat_database_temp_bytes'] ?? 0;
            return files === 0 ? '0 files' : `${files} files (${formatBytes(bytes)})`;
          },
        },
        {
          label: 'Extension Updates',
          getter: ([name]: [string, unknown]) => {
            const extensions = extensionsWithUpdate(series!, name);
            return extensions.length === 0 ? 'Up to date' : extensions.join(', ');
          },
        },
      ]}
      data={rows}
    />
  );
}

function StatusStrip({ series }: { series: PrometheusSeries | null }) {
  if (!series) {
    return null;
  }

  const nodesUsed = scalarMetric(series, 'cnpg_collector_nodes_used');
  const fenced = scalarMetric(series, 'cnpg_collector_fencing_on') === 1;
  const switchoverRequired =
    scalarMetric(series, 'cnpg_collector_manual_switchover_required') === 1;
  const extensionUpdates = sumMetric(series, 'cnpg_pg_extensions_update_available');

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 2 }}>
      {nodesUsed > 0 && (
        <Typography variant="caption" color="text.secondary">
          Instances spread across {nodesUsed} node{nodesUsed === 1 ? '' : 's'}
        </Typography>
      )}
      {fenced && <Chip size="small" color="error" label="Instance Fenced" />}
      {switchoverRequired && (
        <Chip size="small" color="warning" label="Manual Switchover Required" />
      )}
      {extensionUpdates > 0 && (
        <Chip
          size="small"
          color="info"
          label={`${extensionUpdates} extension update${
            extensionUpdates === 1 ? '' : 's'
          } available`}
        />
      )}
    </Box>
  );
}

function MetricsSection({ cluster }: { cluster: Cluster }) {
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });
  const [selectedInstance, setSelectedInstance] = useState(cluster.currentPrimary ?? '');
  const [refreshSeconds, setRefreshSeconds] = useState(0);

  const primaryPod = pods?.find(pod => pod.getName() === cluster.currentPrimary) ?? null;
  const selectedPod = pods?.find(pod => pod.getName() === selectedInstance) ?? primaryPod;

  // Hooks must run unconditionally, before the currentPrimary bootstrapping check below.
  const primaryResult = usePodMetrics(primaryPod, refreshSeconds);
  const selectedIsPrimary = selectedPod?.getName() === primaryPod?.getName();
  const selectedResultOwn = usePodMetrics(selectedIsPrimary ? null : selectedPod, refreshSeconds);
  const selectedResult = selectedIsPrimary ? primaryResult : selectedResultOwn;

  if (!cluster.currentPrimary) {
    return null;
  }

  const instanceOptions = sortByName(pods).sort((a, b) =>
    a.getName() === cluster.currentPrimary ? -1 : b.getName() === cluster.currentPrimary ? 1 : 0
  );
  const metricsByCategory = new Map(groupMetricsByCategory(POSTGRES_METRICS));

  const selectedSubtitle = selectedPod
    ? `${selectedPod.getName()} - ${selectedPod.metadata.labels?.['cnpg.io/instanceRole'] ?? '-'}`
    : undefined;

  return (
    <SectionBox
      title="Live Metrics"
      headerProps={{
        actions: [
          <Select
            key="refresh-interval"
            size="small"
            value={refreshSeconds}
            onChange={e => setRefreshSeconds(Number(e.target.value))}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value={0}>Auto refresh: Off</MenuItem>
            <MenuItem value={15}>Refresh every 15s</MenuItem>
            <MenuItem value={30}>Refresh every 30s</MenuItem>
            <MenuItem value={60}>Refresh every 60s</MenuItem>
          </Select>,
        ],
      }}
    >
      <StatusStrip series={primaryResult.series} />

      <MetricAccordion title={CNPG_REPLICATION}>
        <MetricTileGrid
          metrics={metricsByCategory.get(CNPG_REPLICATION) ?? []}
          result={primaryResult}
        />
        <StandbysTable series={primaryResult.series} />
        <ReplicationSlotsTable series={primaryResult.series} />
      </MetricAccordion>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Select
          size="small"
          value={selectedInstance}
          onChange={e => setSelectedInstance(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          {instanceOptions.map(pod => (
            <MenuItem key={pod.getName()} value={pod.getName()}>
              {pod.getName()} ({pod.metadata.labels?.['cnpg.io/instanceRole'] ?? '-'})
            </MenuItem>
          ))}
        </Select>
      </Box>

      <MetricAccordion title={GENERAL_HEALTH} subtitle={selectedSubtitle}>
        <MetricTileGrid
          metrics={metricsByCategory.get(GENERAL_HEALTH) ?? []}
          result={selectedResult}
        />
      </MetricAccordion>

      <MetricAccordion title={CHECKPOINTING} subtitle={selectedSubtitle}>
        <MetricTileGrid
          metrics={metricsByCategory.get(CHECKPOINTING) ?? []}
          result={selectedResult}
        />
      </MetricAccordion>

      <MetricAccordion title="Database Health" subtitle={selectedSubtitle}>
        <DatabaseHealthTable series={selectedResult.series} />
      </MetricAccordion>
    </SectionBox>
  );
}

function InstancesSection({ cluster }: { cluster: Cluster }) {
  // cnpg.io/podRole=instance excludes the transient initdb/join/full-recovery bootstrap job pods
  // (see JobsSection), which also carry the cnpg.io/cluster label but aren't instances.
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });

  return (
    <SectionBox title="Instances">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pod: Pod) => <ResourceLink resource={pod} />,
          },
          {
            label: 'Role',
            getter: (pod: Pod) => <InstanceRoleLabel pod={pod} />,
          },
          {
            label: 'Status',
            getter: (pod: Pod) => <PodStatusLabel pod={pod} />,
          },
          {
            label: 'Timeline',
            getter: (pod: Pod) =>
              cluster.getInstanceReportedState(pod.getName())?.timeLineID ?? '-',
          },
          {
            label: 'Node',
            getter: (pod: Pod) => pod.spec.nodeName,
          },
          {
            label: 'QoS',
            getter: (pod: Pod) => pod.status.qosClass ?? '-',
          },
          {
            label: 'Actions',
            getter: (pod: Pod) => <InstanceActions cluster={cluster} pod={pod} />,
          },
        ]}
        data={sortByName(pods)}
      />
    </SectionBox>
  );
}

function JobsSection({ cluster }: { cluster: Cluster }) {
  // cnpg.io/jobRole (initdb, join, full-recovery, ...) identifies the transient bootstrap job
  // pods CNPG creates alongside instances — they carry cnpg.io/cluster too but not podRole.
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/jobRole`,
  });

  // Hide the section once we know there are no bootstrap jobs, rather than showing an empty
  // table — but keep rendering (with a loading state) while pods is still null.
  if (pods && pods.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Jobs">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pod: Pod) => <ResourceLink resource={pod} />,
          },
          {
            label: 'Job Role',
            getter: (pod: Pod) => pod.metadata.labels?.['cnpg.io/jobRole'] ?? '-',
          },
          {
            label: 'Phase',
            getter: (pod: Pod) => <PodPhaseLabel pod={pod} />,
          },
          {
            label: 'Node',
            getter: (pod: Pod) => pod.spec.nodeName,
          },
          {
            label: 'Actions',
            getter: (pod: Pod) => <JobActions pod={pod} />,
          },
        ]}
        data={sortByName(pods)}
        emptyMessage="No bootstrap jobs running"
      />
    </SectionBox>
  );
}

function PvcPhaseLabel({ pvc }: { pvc: Pvc }) {
  const phase = pvc.status?.phase;
  switch (phase) {
    case 'Bound':
      return <StatusLabel status="success">{phase}</StatusLabel>;
    case 'Lost':
      return <StatusLabel status="error">{phase}</StatusLabel>;
    case 'Pending':
      return <StatusLabel status="warning">{phase}</StatusLabel>;
    default:
      return <StatusLabel status="">{phase}</StatusLabel>;
  }
}

function PvcsSection({ cluster }: { cluster: Cluster }) {
  // Every instance can have more than one PVC (PG_DATA, PG_WAL, and optionally per-tablespace
  // volumes), each labeled with which instance and role it belongs to.
  const [pvcs] = K8s.ResourceClasses.PersistentVolumeClaim.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()}`,
  });

  return (
    <SectionBox title="Storage">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pvc: Pvc) => <ResourceLink resource={pvc} />,
          },
          {
            label: 'Instance',
            getter: (pvc: Pvc) => pvc.metadata.labels?.['cnpg.io/instanceName'] ?? '-',
          },
          {
            label: 'Role',
            getter: (pvc: Pvc) => pvc.metadata.labels?.['cnpg.io/pvcRole'] ?? '-',
          },
          {
            label: 'Status',
            getter: (pvc: Pvc) => <PvcPhaseLabel pvc={pvc} />,
          },
          {
            label: 'Capacity',
            getter: (pvc: Pvc) =>
              pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage ?? '-',
          },
          {
            label: 'Storage Class',
            getter: (pvc: Pvc) => pvc.spec?.storageClassName ?? '-',
          },
        ]}
        data={sortByName(pvcs)}
      />
    </SectionBox>
  );
}

function PoolersSection({ cluster }: { cluster: Cluster }) {
  // Poolers reference their cluster by spec.cluster.name rather than a label, so we fetch
  // every Pooler in the namespace and filter client-side instead of using a labelSelector.
  const [allPoolers] = Pooler.useList({ namespace: cluster.getNamespace() });
  const poolers = allPoolers?.filter(pooler => pooler.clusterName === cluster.getName());

  if (poolers && poolers.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Poolers">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            // ResourceLink defaults its route lookup to resource.kind ('Pooler'), but our route
            // is registered as 'CNPG Pooler' (see index.tsx) to dodge a naming collision —
            // so the default lookup fails silently and needs this explicit override. Pod/PVC
            // links elsewhere in this file don't need it since those are core Headlamp types
            // whose routes are already registered under their bare kind name.
            getter: (pooler: Pooler) => <ResourceLink resource={pooler} routeName="CNPG Pooler" />,
          },
          {
            label: 'Type',
            getter: (pooler: Pooler) => pooler.type,
          },
          {
            label: 'Pool Mode',
            getter: (pooler: Pooler) => pooler.poolMode ?? '-',
          },
          {
            label: 'Instances',
            getter: (pooler: Pooler) => pooler.instances,
          },
          {
            label: 'Status',
            getter: (pooler: Pooler) => <PoolerStatusLabel pooler={pooler} />,
          },
        ]}
        data={sortByName(poolers)}
      />
    </SectionBox>
  );
}

function FailoverQuorumSection({ cluster }: { cluster: Cluster }) {
  // CNPG maintains at most one FailoverQuorum per Cluster, in the same namespace and under the
  // same name, and deletes it as soon as quorum-based failover is switched off. So a 404 here is
  // the ordinary "not enabled" case, not an error worth showing — render nothing rather than
  // putting an empty section on every cluster page.
  const [quorum] = FailoverQuorum.useGet(cluster.getName(), cluster.getNamespace(), {
    cluster: cluster.cluster,
  });

  if (!quorum) {
    return null;
  }

  const standbyNames = quorum.standbyNames;

  return (
    <SectionBox title="Failover Quorum">
      <NameValueTable
        rows={[
          {
            name: 'Method',
            value: quorum.method ?? '-',
          },
          {
            name: 'Sync Standbys Required',
            value: quorum.standbyNumber ?? '-',
          },
          {
            name: 'Reporting Primary',
            value: quorum.primary ?? '-',
          },
          {
            name: 'Candidate Standbys',
            value: standbyNames.length > 0 ? standbyNames.join(', ') : '-',
          },
        ]}
      />
    </SectionBox>
  );
}

// CNPG maintains exactly one Lease per Cluster, same name and namespace, used for leader election
// among instances — so a missing Lease (e.g. right after cluster creation) is a transient,
// ordinary state, not an error worth showing (renders as '-' rather than nothing).
function leaseValue(lease: Lease | null) {
  if (!lease) {
    return '-';
  }

  // The API also sets spec.acquireTime, which the SDK's LeaseSpec type omits.
  const spec = lease.spec as typeof lease.spec & { acquireTime?: string };

  return (
    <Tooltip
      title={
        <>
          Acquired: {spec.acquireTime ? localeDate(spec.acquireTime) : '-'}
          <br />
          Duration: {spec.leaseDurationSeconds}s<br />
          Transitions: {spec.leaseTransitions}
        </>
      }
    >
      <span>
        {spec.holderIdentity
          ? `${spec.holderIdentity} (renewed ${spec.renewTime ? localeDate(spec.renewTime) : '-'})`
          : '-'}
      </span>
    </Tooltip>
  );
}

function InstancesTab({ cluster }: { cluster: Cluster }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <InstancesSection cluster={cluster} />
      <JobsSection cluster={cluster} />
      <PoolersSection cluster={cluster} />
    </Box>
  );
}

function BackupsTab({ cluster }: { cluster: Cluster }) {
  const [backups] = Backup.useList({ namespace: cluster.getNamespace() });
  const [scheduled] = ScheduledBackup.useList({ namespace: cluster.getNamespace() });

  const clusterBackups = useMemo(
    () =>
      sortByName((backups ?? []).filter(b => b.clusterName === cluster.getName())).sort((a, b) =>
        (b.jsonData.metadata?.creationTimestamp ?? '').localeCompare(
          a.jsonData.metadata?.creationTimestamp ?? ''
        )
      ),
    [backups, cluster]
  );
  const clusterSchedules = useMemo(
    () => sortByName((scheduled ?? []).filter(s => s.clusterName === cluster.getName())),
    [scheduled, cluster]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <SectionBox title="Backups">
        <SimpleTable
          columns={[
            { label: 'Name', getter: (backup: Backup) => backup.getName() },
            {
              label: 'Phase',
              getter: (backup: Backup) => <BackupPhaseLabel backup={backup} />,
            },
            { label: 'Method', getter: (backup: Backup) => backup.method },
            {
              label: 'Started',
              getter: (backup: Backup) => (backup.startedAt ? localeDate(backup.startedAt) : '-'),
            },
            {
              label: 'Completed',
              getter: (backup: Backup) => (backup.stoppedAt ? localeDate(backup.stoppedAt) : '-'),
            },
            { label: 'Error', getter: (backup: Backup) => backup.error ?? '-' },
          ]}
          data={clusterBackups}
          emptyMessage="No backups for this cluster yet"
        />
      </SectionBox>
      <SectionBox title="Scheduled Backups">
        <SimpleTable
          columns={[
            { label: 'Name', getter: (item: ScheduledBackup) => item.getName() },
            {
              label: 'Schedule',
              getter: (item: ScheduledBackup) => (
                <ScheduledBackupScheduleLabel schedule={item.schedule} />
              ),
            },
            {
              label: 'Status',
              getter: (item: ScheduledBackup) => (
                <ScheduledBackupSuspendLabel scheduledBackup={item} />
              ),
            },
            {
              label: 'Last Run',
              getter: (item: ScheduledBackup) =>
                item.lastScheduleTime ? localeDate(item.lastScheduleTime) : '-',
            },
            {
              label: 'Next Run',
              getter: (item: ScheduledBackup) =>
                item.nextScheduleTime ? localeDate(item.nextScheduleTime) : '-',
            },
          ]}
          data={clusterSchedules}
          emptyMessage="No scheduled backups for this cluster"
        />
      </SectionBox>
    </Box>
  );
}

function ConfigurationTab({ cluster, lease }: { cluster: Cluster; lease: Lease | null }) {
  const synchronous = cluster.spec.postgresql?.synchronous;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <SectionBox title="Configuration">
        <NameValueTable
          rows={[
            {
              name: 'Instances',
              value: `${cluster.readyInstances} ready / ${cluster.instances} total`,
            },
            { name: 'PostgreSQL Image', value: cluster.image ?? cluster.spec.imageName ?? '-' },
            {
              name: 'Image Catalog',
              value: cluster.imageCatalogRef
                ? `${cluster.imageCatalogRef.kind}/${cluster.imageCatalogRef.name} (major ${cluster.imageCatalogRef.major})`
                : '-',
            },
            { name: 'Primary', value: cluster.primaryLabel },
            { name: 'Lease', value: leaseValue(lease) },
            { name: 'Storage Size', value: cluster.spec.storage?.size ?? '-' },
            { name: 'Storage Class', value: cluster.spec.storage?.storageClass ?? '-' },
            { name: 'WAL Storage', value: cluster.spec.walStorage?.size ?? '-' },
            {
              name: 'Synchronous Replication',
              value: cluster.hasSynchronousReplication
                ? `On (${cluster.syncReplicasRequired} required, method ${
                    synchronous?.method ?? '-'
                  })`
                : cluster.instances > 1
                ? 'Off — multiple instances without synchronous replication risk data loss on failover'
                : 'N/A (single instance)',
            },
            {
              name: 'Bootstrap Recovery Source',
              value: cluster.spec.bootstrap?.recovery?.source ?? '-',
            },
            {
              name: 'Volume Snapshot Class',
              value: cluster.volumeSnapshotClassName ?? '-',
            },
            { name: 'System ID', value: cluster.systemID ?? '-' },
            { name: 'Timeline', value: cluster.timelineID ?? '-' },
          ]}
        />
      </SectionBox>
      <FailoverQuorumSection cluster={cluster} />
      <SectionBox title="Conditions">
        <ConditionsTable resource={cluster.jsonData} />
      </SectionBox>
    </Box>
  );
}

function ClusterHeaderActions({ cluster }: { cluster: Cluster }) {
  const history = useHistory();
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <ActionButton
        description="Connect"
        icon="mdi:power-plug-outline"
        onClick={() => launchConnectActivity(cluster)}
      />
      <ActionButton
        description="View Databases"
        icon="mdi:database-outline"
        onClick={() =>
          history.push(
            `${createRouteURL(
              'CNPG Databases'
            )}?cluster=${cluster.getName()}&namespace=${cluster.getNamespace()}`
          )
        }
      />
      <ActionButton
        description="View Roles"
        icon="mdi:account-key-outline"
        onClick={() =>
          history.push(
            `${createRouteURL(
              'CNPG Database Roles'
            )}?cluster=${cluster.getName()}&namespace=${cluster.getNamespace()}`
          )
        }
      />
      <ActionButton
        description="View Backups"
        icon="mdi:backup-restore"
        onClick={() =>
          history.push(
            `${createRouteURL(
              'CNPG Backups'
            )}?cluster=${cluster.getName()}&namespace=${cluster.getNamespace()}`
          )
        }
      />
      <ActionButton
        description="View Scheduled Backups"
        icon="mdi:calendar-clock"
        onClick={() =>
          history.push(
            `${createRouteURL(
              'CNPG Scheduled Backups'
            )}?cluster=${cluster.getName()}&namespace=${cluster.getNamespace()}`
          )
        }
      />
      <ActionButton
        description="View Publications"
        icon="mdi:upload-network-outline"
        onClick={() =>
          history.push(
            `${createRouteURL(
              'CNPG Publications'
            )}?cluster=${cluster.getName()}&namespace=${cluster.getNamespace()}`
          )
        }
      />
      <ActionButton
        description="View Subscriptions"
        icon="mdi:download-network-outline"
        onClick={() =>
          history.push(
            `${createRouteURL(
              'CNPG Subscriptions'
            )}?cluster=${cluster.getName()}&namespace=${cluster.getNamespace()}`
          )
        }
      />
      <EditButton item={cluster} />
      <DeleteButton item={cluster} />
    </Box>
  );
}

export function ClusterDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();
  const selectedCluster = K8s.useCluster();
  const [activeTab, setActiveTab] = useState(0);

  const [cluster, clusterError] = Cluster.useGet(name, namespace, {
    cluster: selectedCluster ?? undefined,
  });
  const [lease] = K8s.ResourceClasses.Lease.useGet(name, namespace, {
    cluster: selectedCluster ?? undefined,
  });

  if (clusterError) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" color="error">
          Failed to load Cluster {namespace}/{name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {String(clusterError)}
        </Typography>
      </Box>
    );
  }

  if (!cluster) {
    return <Loader title={`Loading Cluster ${namespace}/${name}`} />;
  }

  const created = cluster.jsonData.metadata?.creationTimestamp;

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <CnpgLogo size={36} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {cluster.getName()}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Namespace{' '}
              <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                {cluster.getNamespace()}
              </Box>
              <Box component="span" sx={{ mx: 1 }}>
                |
              </Box>
              Created {created ? formatCreatedDate(created) : `Age ${cluster.getAge()}`}
            </Typography>
          </Box>
        </Box>
        <ClusterHeaderActions cluster={cluster} />
      </Box>

      <SummaryStrip cluster={cluster} />

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} variant="scrollable">
          <Tab label="Overview" />
          <Tab label="Instances" />
          <Tab label="Live Metrics" />
          <Tab
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                {cluster.isLastBackupSucceeded !== undefined && (
                  <HealthStatusIcon
                    healthy={cluster.isLastBackupSucceeded}
                    size={16}
                    title={
                      cluster.isLastBackupSucceeded
                        ? 'Last backup succeeded'
                        : 'Last backup did not succeed'
                    }
                  />
                )}
                Backups
              </Box>
            }
          />
          <Tab label="Storage" />
          <Tab label="Configuration" />
          <Tab label="Events" />
        </Tabs>
      </Box>

      {activeTab === 0 && <OverviewTab cluster={cluster} lease={lease} />}
      {activeTab === 1 && <InstancesTab cluster={cluster} />}
      {activeTab === 2 && <MetricsSection cluster={cluster} />}
      {activeTab === 3 && <BackupsTab cluster={cluster} />}
      {activeTab === 4 && <PvcsSection cluster={cluster} />}
      {activeTab === 5 && <ConfigurationTab cluster={cluster} lease={lease} />}
      {activeTab === 6 && <RecentEventsCard cluster={cluster} />}
    </Box>
  );
}
