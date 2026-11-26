import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KlioServer } from '../../resources/klioServer';
import { execCommand } from '../common/podExec';
import {
  formatBackupDuration,
  formatBackupTime,
  formatLsn,
  KlioBackupEntry,
  parseListBackups,
} from './backups';

// Green check for a present tier, empty cell otherwise — same explicit tones as the cluster
// details page's health icon, since Headlamp's own success.main is unreadable in dark mode.
function TierCheck({ present }: { present: boolean }) {
  if (!present) {
    return null;
  }
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        verticalAlign: 'middle',
        color: theme => (theme.palette.mode === 'dark' ? '#66bb6a' : '#2e7d32'),
      }}
    >
      <Icon icon="mdi:check" width={18} height={18} />
    </Box>
  );
}

interface BackupsState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  entries: KlioBackupEntry[];
  error: string | null;
  refreshedAt: string | null;
}

const initialState: BackupsState = {
  status: 'idle',
  entries: [],
  error: null,
  refreshedAt: null,
};

export function KlioServerBackupsSection({ server }: { server: KlioServer }) {
  // Same label the operator stamps on the Server's PVCs (verified live) — the server pod
  // carries it too, and has no ownerReferences to follow instead.
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: server.getNamespace(),
    labelSelector: `klio.cnpg.io/klio-server=${server.getName()}`,
  });
  const [state, setState] = useState<BackupsState>(initialState);
  const cancelRef = useRef<(() => void) | null>(null);

  const fetchBackups = useCallback(() => {
    const pod = (pods ?? []).find(p => p.status?.phase === 'Running') ?? pods?.[0];
    if (!pod) {
      setState({
        status: 'error',
        entries: [],
        error: 'No server pod found.',
        refreshedAt: null,
      });
      return;
    }
    const containers = pod.spec?.containers ?? [];
    const container =
      containers.find(c => c.name === 'server')?.name ?? containers[0]?.name;
    if (!container) {
      setState({
        status: 'error',
        entries: [],
        error: `Pod ${pod.getName()} has no containers.`,
        refreshedAt: null,
      });
      return;
    }

    cancelRef.current?.();
    setState(prev => ({ ...prev, status: 'loading', error: null }));
    const { result, cancel } = execCommand(pod, container, ['klio', 'admin', 'list-backups']);
    cancelRef.current = cancel;
    result.then(
      ({ stdout, stderr }) => {
        if (!stdout.trim() && !stderr.trim()) {
          setState({
            status: 'error',
            entries: [],
            error:
              'The exec session closed without any output — check pods/exec permission on this pod.',
            refreshedAt: null,
          });
          return;
        }
        try {
          const entries = parseListBackups(stdout.trim());
          setState({
            status: 'loaded',
            entries,
            error: null,
            refreshedAt: new Date().toLocaleString(),
          });
        } catch (err) {
          const detail = stderr.trim() || stdout.trim().slice(0, 300);
          setState({
            status: 'error',
            entries: [],
            error: `${err instanceof Error ? err.message : 'Could not parse backup list.'}${
              detail ? ` ${detail}` : ''
            }`,
            refreshedAt: null,
          });
        }
      },
      err => {
        setState({
          status: 'error',
          entries: [],
          error: err instanceof Error ? err.message : 'Could not list backups.',
          refreshedAt: null,
        });
      }
    );
  }, [pods]);

  // Fetch once the pod list is known; cancel any in-flight exec on unmount or re-fetch.
  useEffect(() => {
    if (pods) {
      fetchBackups();
    }
    return () => cancelRef.current?.();
  }, [pods, fetchBackups]);

  return (
    <SectionBox title="Backups">
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, mb: 1 }}>
        {state.refreshedAt && (
          <Typography variant="caption" color="text.secondary">
            Updated {state.refreshedAt}
          </Typography>
        )}
        <Button
          variant="outlined"
          size="small"
          disabled={state.status === 'loading'}
          onClick={fetchBackups}
        >
          Refresh
        </Button>
      </Box>
      {state.status === 'loading' && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Listing backups on the server pod…
        </Typography>
      )}
      {state.status === 'error' && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {state.error}
        </Alert>
      )}
      <SimpleTable
        columns={[
          { label: 'Cluster', getter: (backup: KlioBackupEntry) => backup.clusterName },
          {
            label: 'Name',
            getter: (backup: KlioBackupEntry) =>
              backup.backupLabel ? (
                <Tooltip
                  title={backup.backupLabel}
                  componentsProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}
                >
                  <span>{backup.name}</span>
                </Tooltip>
              ) : (
                backup.name
              ),
          },
          {
            label: 'Started',
            getter: (backup: KlioBackupEntry) => {
              const duration = formatBackupDuration(backup.startedAt, backup.stoppedAt);
              return (
                <Tooltip title={duration ? `Duration: ${duration}` : 'Still running'}>
                  <span>{formatBackupTime(backup.startedAt)}</span>
                </Tooltip>
              );
            },
          },
          {
            label: 'Start WAL',
            getter: (backup: KlioBackupEntry) => (
              <Tooltip title={`Start LSN: ${formatLsn(backup.startLsn)}`}>
                <span>{backup.startWal}</span>
              </Tooltip>
            ),
          },
          {
            label: 'End WAL',
            getter: (backup: KlioBackupEntry) => (
              <Tooltip title={`End LSN: ${formatLsn(backup.endLsn)}`}>
                <span>{backup.endWal}</span>
              </Tooltip>
            ),
          },
          {
            label: 'Tier 1',
            getter: (backup: KlioBackupEntry) => <TierCheck present={backup.tier1} />,
            // Shrink-wrapped track: SimpleTable lays columns out as a grid of equal 1fr tracks
            // by default, so a cell width alone can't collapse the whitespace.
            gridTemplate: 'max-content',
            cellProps: { align: 'center' },
          },
          {
            label: 'Tier 2',
            getter: (backup: KlioBackupEntry) => <TierCheck present={backup.tier2} />,
            gridTemplate: 'max-content',
            cellProps: { align: 'center' },
          },
        ]}
        data={state.entries}
        emptyMessage={
          state.status === 'loaded' ? 'No backups on this server' : 'Backup list not loaded yet'
        }
      />
    </SectionBox>
  );
}
