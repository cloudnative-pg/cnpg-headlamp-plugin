import { Icon } from '@iconify/react';
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { ActionButton, AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useSnackbar } from 'notistack';
import { useCallback, useEffect, useState } from 'react';
import { Pod } from './podActions';

const POSTGRES_PORT = '5432';
const LOCAL_HOST = 'localhost';
const POLL_INTERVAL_MS = 4000;

export type InstanceRole = 'primary' | 'standby';

// Shape of the entries Headlamp's backend returns from /portforward/list (the SDK types it as
// PortForward, but that type isn't reachable from a plugin's import surface).
interface PortForwardEntry {
  id: string;
  pod: string;
  namespace: string;
  cluster: string;
  port: string;
  targetPort: string;
  status?: string;
  error?: string;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Polls Headlamp's backend for the active port-forwards of one Headlamp cluster context and
 * returns the running PostgreSQL ones, keyed by pod name. The backend (not this plugin) owns the
 * forward's lifetime, so polling is the only way to notice a forward started elsewhere (Headlamp's
 * own Pod page) or one that died.
 */
export function usePostgresPortForwards(
  cluster: string | undefined,
  namespace: string
): { forwards: Map<string, PortForwardEntry>; refresh: () => void } {
  const [forwards, setForwards] = useState<Map<string, PortForwardEntry>>(new Map());

  const refresh = useCallback(() => {
    if (!cluster) return;
    ApiProxy.listPortForward(cluster)
      .then((entries: PortForwardEntry[] | null) => {
        const next = new Map<string, PortForwardEntry>();
        (entries ?? []).forEach(entry => {
          if (
            entry.namespace === namespace &&
            entry.targetPort === POSTGRES_PORT &&
            entry.status === 'Running'
          ) {
            next.set(entry.pod, entry);
          }
        });
        setForwards(next);
      })
      // The list is a nicety; a failing backend just means no connection state is shown.
      .catch(() => {});
  }, [cluster, namespace]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { forwards, refresh };
}

function decode(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return atob(value);
  } catch {
    return undefined;
  }
}

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const { enqueueSnackbar } = useSnackbar();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 90, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="code"
        sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontFamily: 'monospace' }}
      >
        {value}
      </Typography>
      <Tooltip title={`Copy ${label.toLowerCase()}`}>
        <IconButton
          size="small"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            navigator.clipboard
              .writeText(value)
              .then(() => enqueueSnackbar(`${label} copied`, { variant: 'success' }))
              .catch(() =>
                enqueueSnackbar('Could not copy to the clipboard', { variant: 'error' })
              );
          }}
        >
          <Icon icon={secret ? 'mdi:key-outline' : 'mdi:content-copy'} width={16} height={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function CodeBlock({ label, command }: { label: string; command: string }) {
  const { enqueueSnackbar } = useSnackbar();
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          mt: 0.25,
          p: 1,
          borderRadius: 1,
          bgcolor: 'action.hover',
        }}
      >
        <Typography
          component="pre"
          variant="body2"
          sx={{
            m: 0,
            flex: 1,
            minWidth: 0,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {command}
        </Typography>
        <Tooltip title="Copy">
          <IconButton
            size="small"
            aria-label={`Copy ${label}`}
            onClick={() => {
              navigator.clipboard
                .writeText(command)
                .then(() => enqueueSnackbar('Copied', { variant: 'success' }))
                .catch(() =>
                  enqueueSnackbar('Could not copy to the clipboard', { variant: 'error' })
                );
            }}
          >
            <Icon icon="mdi:content-copy" width={16} height={16} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function roleDescription(role: InstanceRole): string {
  return role === 'primary'
    ? 'Connect to the primary PostgreSQL instance. Reads and writes are allowed.'
    : 'Connect to a standby instance. PostgreSQL connections are read-only: writes are rejected, but you can run queries and inspect replication.';
}

function PortForwardDialog({
  pod,
  clusterName,
  role,
  forward,
  onClose,
  onChanged,
}: {
  pod: Pod;
  clusterName: string;
  role: InstanceRole;
  forward?: PortForwardEntry;
  onClose: () => void;
  onChanged: () => void;
}) {
  const namespace = pod.metadata.namespace;
  const secretName = `${clusterName}-app`;
  const [secret] = K8s.ResourceClasses.Secret.useGet(secretName, namespace, {
    cluster: pod.cluster,
  });
  const secretData = secret?.jsonData?.data ?? {};
  // Fall back to the operator's defaults if the secret is missing or still loading, so the
  // instructions stay usable for clusters bootstrapped with a custom owner/database.
  const username = decode(secretData.username) ?? 'app';
  const database = decode(secretData.dbname) ?? 'app';

  const [localPort, setLocalPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = !!forward;
  // Empty means "let the backend pick a free port", like Headlamp's own pod port-forward; the
  // real port is only known once the forward is running.
  const port = forward?.port ?? localPort;
  const displayPort = port || '<local-port>';

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await ApiProxy.startPortForward(
        pod.cluster,
        namespace,
        pod.metadata.name,
        POSTGRES_PORT,
        '',
        namespace,
        localPort || undefined,
        LOCAL_HOST
      );
      onChanged();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!forward) return;
    setBusy(true);
    setError(null);
    try {
      await ApiProxy.stopOrDeletePortForward(pod.cluster, forward.id, false);
      onChanged();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  const portValid =
    port === '' || (/^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) < 65536);
  const uri = `postgresql://${username}@${LOCAL_HOST}:${displayPort}/${database}?sslmode=require`;
  const psql = `psql "${uri}"`;
  const passwordCommand = `kubectl get secret ${secretName} -n ${namespace} -o jsonpath='{.data.password}' | base64 -d`;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <span>Port-forward {pod.metadata.name}</span>
        <Chip size="small" label={role === 'primary' ? 'Primary' : 'Standby'} />
      </DialogTitle>
      <DialogContent>
        <Alert severity={role === 'primary' ? 'info' : 'warning'} sx={{ mb: 2 }}>
          {roleDescription(role)}
        </Alert>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <TextField
            size="small"
            label="Local port"
            value={port}
            placeholder="Auto"
            onChange={e => setLocalPort(e.target.value.trim())}
            disabled={running || busy}
            error={!portValid}
            helperText={
              !portValid ? 'Enter a port between 1 and 65535' : 'Empty = pick a free port'
            }
            sx={{ width: 190 }}
          />
          {running ? (
            <Button variant="outlined" color="error" onClick={stop} disabled={busy}>
              Stop port-forward
            </Button>
          ) : (
            <Button variant="contained" onClick={start} disabled={busy || !portValid}>
              Start port-forward
            </Button>
          )}
          <Chip
            size="small"
            color={running ? 'success' : 'default'}
            label={running ? `Forwarding ${LOCAL_HOST}:${port}` : 'Not running'}
          />
        </Box>
        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          The tunnel stays on your machine: nothing is exposed through a Service. It is opened by
          Headlamp&apos;s backend, so it keeps running if you close this dialog.
        </Typography>

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Connection details
        </Typography>
        <CopyRow label="Host" value={LOCAL_HOST} />
        <CopyRow label="Port" value={displayPort} />
        <CopyRow label="Database" value={database} />
        <CopyRow label="Username" value={username} />
        <CopyRow label="Password" value={passwordCommand} secret />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          The password is the <code>password</code> key of the <code>{secretName}</code> Secret in
          namespace <code>{namespace}</code>; the copy button above copies the command that prints
          it.{' '}
          {!secret && 'Username and database shown are the operator defaults (secret not found).'}
        </Typography>

        <CodeBlock label="psql" command={psql} />
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
          pgAdmin
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Register &gt; Server, then on the Connection tab enter the host, port, database, username
          and password above. On the SSL tab set the SSL mode to <code>require</code>.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Per-instance port-forward action for the cluster topology. Opens a dialog (instead of starting
 * the forward right away) so the user sees what they are connecting to first. Disabled — not
 * hidden — for users who can't create `pods/portforward`.
 */
export function PortForwardButton({
  pod,
  clusterName,
  role,
  forward,
  onChanged,
}: {
  pod: Pod;
  clusterName: string;
  role: InstanceRole;
  forward?: PortForwardEntry;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Fails open until the check resolves; the API still enforces RBAC server-side.
  const [allowed, setAllowed] = useState(true);

  const button = (
    <ActionButton
      description={forward ? `Port-forward (localhost:${forward.port})` : 'Port-forward'}
      icon={forward ? 'mdi:lan-connect' : 'mdi:lan-pending'}
      onClick={() => setOpen(true)}
      iconButtonProps={{ disabled: !allowed }}
    />
  );

  return (
    <>
      <AuthVisible
        item={pod}
        authVerb="create"
        subresource="portforward"
        onAuthResult={({ allowed: result }) => setAllowed(result)}
      >
        {null}
      </AuthVisible>
      {allowed ? (
        button
      ) : (
        <Tooltip title="You don't have permission to port-forward to this pod.">
          <span>{button}</span>
        </Tooltip>
      )}
      {open && (
        <PortForwardDialog
          pod={pod}
          clusterName={clusterName}
          role={role}
          forward={forward}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

export type { PortForwardEntry };
