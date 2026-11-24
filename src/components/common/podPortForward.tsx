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
import Link from '@mui/material/Link';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useSnackbar } from 'notistack';
import { ReactElement, useCallback, useEffect, useState } from 'react';
import { Pod } from './podActions';

const POSTGRES_PORT = '5432';
const LOCAL_HOST = 'localhost';
const POLL_INTERVAL_MS = 4000;

export type InstanceRole = 'primary' | 'standby';
type ClientTab = 'psql' | 'pgadmin';

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

// `masked` hides the value behind bullets until the user reveals it; copying always copies the
// real value either way.
function CopyRow({ label, value, masked }: { label: string; value: string; masked?: boolean }) {
  const { enqueueSnackbar } = useSnackbar();
  const [revealed, setRevealed] = useState(false);
  const hidden = masked && !revealed;
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
        {hidden ? '••••••••••••' : value}
      </Typography>
      {masked && (
        <Tooltip title={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
          <IconButton
            size="small"
            aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            onClick={() => setRevealed(r => !r)}
          >
            <Icon
              icon={revealed ? 'mdi:eye-off-outline' : 'mdi:eye-outline'}
              width={16}
              height={16}
            />
          </IconButton>
        </Tooltip>
      )}
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
          <Icon icon="mdi:content-copy" width={16} height={16} />
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
  initialClient,
  onClose,
  onChanged,
}: {
  pod: Pod;
  clusterName: string;
  role: InstanceRole;
  forward?: PortForwardEntry;
  initialClient: ClientTab;
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
  const password = decode(secretData.password);
  const database = decode(secretData.dbname) ?? 'app';

  const [localPort, setLocalPort] = useState('');
  const [client, setClient] = useState<ClientTab>(initialClient);
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
  // For users without a local psql: the container reaches the forwarded port on the host through
  // host.docker.internal (Docker Desktop on macOS/Windows; on Linux add
  // --add-host=host.docker.internal:host-gateway).
  const dockerUri = uri.replace(`@${LOCAL_HOST}:`, '@host.docker.internal:');
  const dockerPsql = `docker run --rm -it postgres:17 psql "${dockerUri}"`;
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

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
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
            variant={running ? 'outlined' : 'filled'}
            icon={running ? <Icon icon="mdi:lan-connect" width={14} height={14} /> : undefined}
            label={running ? `${LOCAL_HOST}:${port}` : 'Not running'}
          />
          <Tooltip title="The tunnel stays on your machine: nothing is exposed through a Service. It is opened by Headlamp's backend, so it keeps running if you close this dialog.">
            <Box
              component="span"
              tabIndex={0}
              aria-label="About this port-forward"
              sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}
            >
              <Icon icon="mdi:information-outline" width={20} height={20} />
            </Box>
          </Tooltip>
        </Box>
        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
          Connection details
        </Typography>
        <CopyRow label="Host" value={LOCAL_HOST} />
        <CopyRow label="Port" value={displayPort} />
        <CopyRow label="Database" value={database} />
        <CopyRow label="Username" value={username} />
        {password ? (
          <CopyRow label="Password" value={password} masked />
        ) : (
          <CopyRow label="Password" value={passwordCommand} />
        )}
        {!password && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Could not read the <code>password</code> key of the <code>{secretName}</code> Secret in
            namespace <code>{namespace}</code> (missing, or you can&apos;t read it), so the copy
            button copies the command that prints it. Username and database shown are the operator
            defaults.
          </Typography>
        )}

        <Tabs
          value={client}
          onChange={(_, value) => setClient(value)}
          sx={{ mt: 1, minHeight: 40, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            value="psql"
            label="psql"
            icon={<Icon icon="mdi:console" width={18} height={18} />}
            iconPosition="start"
            sx={{ minHeight: 40, textTransform: 'none' }}
          />
          <Tab
            value="pgadmin"
            label="pgAdmin"
            icon={<Icon icon="simple-icons:postgresql" width={18} height={18} />}
            iconPosition="start"
            sx={{ minHeight: 40, textTransform: 'none' }}
          />
        </Tabs>
        {client === 'psql' ? (
          <>
            <CodeBlock label="psql" command={psql} />
            <CodeBlock label="psql via Docker" command={dockerPsql} />
          </>
        ) : (
          <>
            <Box component="ol" sx={{ pl: 2.5, mt: 1.5, mb: 0, typography: 'body2' }}>
              <li>
                In pgAdmin, right-click <strong>Servers</strong> and choose{' '}
                <strong>Register &gt; Server…</strong>.
              </li>
              <li>
                On the <strong>General</strong> tab, give it a name (for example{' '}
                <code>{clusterName}</code>).
              </li>
              <li>
                On the <strong>Connection</strong> tab, enter the host, port, database, username and
                password shown above.
              </li>
              <li>
                On the <strong>Parameters</strong> tab, set <strong>SSL mode</strong> to{' '}
                <code>require</code>.
              </li>
              <li>Save. The connection works only while the port-forward is running.</li>
            </Box>
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              See the{' '}
              <Link
                href="https://www.pgadmin.org/docs/pgadmin4/latest/server_dialog.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                official pgAdmin documentation
              </Link>{' '}
              for the full list of server options.
            </Typography>
          </>
        )}
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
  // Which client tab the dialog opens on; null while it's closed.
  const [open, setOpen] = useState<ClientTab | null>(null);
  // Fails open until the check resolves; the API still enforces RBAC server-side.
  const [allowed, setAllowed] = useState(true);

  const withAuth = (button: ReactElement) =>
    allowed ? (
      button
    ) : (
      <Tooltip title="You don't have permission to port-forward to this pod.">
        <span>{button}</span>
      </Tooltip>
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
      {withAuth(
        <ActionButton
          description={forward ? `Port-forward (localhost:${forward.port})` : 'Port-forward'}
          icon={forward ? 'mdi:lan-connect' : 'mdi:lan-pending'}
          onClick={() => setOpen('psql')}
          iconButtonProps={{ disabled: !allowed }}
        />
      )}
      {withAuth(
        <ActionButton
          description="Connect with pgAdmin"
          icon="simple-icons:postgresql"
          onClick={() => setOpen('pgadmin')}
          iconButtonProps={{ disabled: !allowed }}
        />
      )}
      {open && (
        <PortForwardDialog
          pod={pod}
          clusterName={clusterName}
          role={role}
          forward={forward}
          initialClient={open}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

export type { PortForwardEntry };
