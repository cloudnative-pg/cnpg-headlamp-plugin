import { Icon } from '@iconify/react';
import {
  ActionButton,
  AuthVisible,
  ConfirmDialog,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
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
import { useRef, useState } from 'react';
import { Cluster } from '../../../resources/cluster';
import {
  collectEdited,
  diffParameters,
  ExtraRow,
  OPERATOR_MANAGED_PARAMETER_NAMES,
  toMergePatch,
  validateExtras,
} from './diff';
import { CURATED_PARAMETER_NAMES, PARAMETER_GROUPS, ParameterSpec } from './parameters';

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConflict(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 409;
}

function ParameterField({
  spec,
  value,
  onChange,
}: {
  spec: ParameterSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  const tooltip = (
    <>
      {spec.description}
      <br />
      Examples: {spec.examples.join(', ')}
      <br />
      Clear the field to reset it to the operator default, if there is one.
      {spec.restart && (
        <>
          <br />
          Changing it restarts the instances (rolling update).
        </>
      )}
    </>
  );
  const label = spec.name;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {spec.options ? (
        <Autocomplete
          freeSolo
          fullWidth
          size="small"
          options={spec.options}
          inputValue={value}
          onInputChange={(_, next) => onChange(next)}
          renderInput={params => <TextField {...params} label={label} />}
        />
      ) : (
        <TextField
          fullWidth
          size="small"
          label={label}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
      <Tooltip title={tooltip}>
        <Box component="span" sx={{ display: 'inline-flex', color: 'text.secondary' }}>
          <Icon icon="mdi:information-outline" width={18} aria-label={`About ${spec.name}`} />
        </Box>
      </Tooltip>
      {spec.restart && <Chip size="small" color="warning" variant="outlined" label="restart" />}
    </Box>
  );
}

function EditDialog({
  cluster,
  onClose,
  onReload,
}: {
  cluster: Cluster;
  onClose: () => void;
  onReload: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const name = cluster.getName();
  // Captured once, when the dialog opens: the edit is based on this version, so a change made by
  // someone else while the dialog is open is rejected (409) rather than overwritten.
  const [resourceVersion] = useState(cluster.metadata.resourceVersion);
  const [current] = useState<Record<string, string>>(
    () => cluster.spec.postgresql?.parameters ?? {}
  );
  const nextId = useRef(0);
  const [curated, setCurated] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of CURATED_PARAMETER_NAMES) {
      initial[key] = current[key] ?? '';
    }
    return initial;
  });
  const [extras, setExtras] = useState<ExtraRow[]>(() =>
    Object.keys(current)
      .filter(
        key => !CURATED_PARAMETER_NAMES.has(key) && !OPERATOR_MANAGED_PARAMETER_NAMES.has(key)
      )
      .sort()
      .map(key => ({ id: nextId.current++, key, value: current[key] }))
  );
  const [extrasExpanded, setExtrasExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const extraErrors = validateExtras(extras);
  const hasExtraErrors = Object.keys(extraErrors).length > 0;
  const changes = diffParameters(current, collectEdited(curated, extras));
  const restartChanges = changes.filter(change => change.restart);

  const updateExtra = (id: number, patch: Partial<ExtraRow>) =>
    setExtras(rows => rows.map(row => (row.id === id ? { ...row, ...patch } : row)));

  const apply = () => {
    setSaving(true);
    setError(null);
    cluster
      .setPostgresqlParameters(toMergePatch(changes), resourceVersion)
      .then(() => {
        enqueueSnackbar(`PostgreSQL configuration of ${name} updated`, { variant: 'success' });
        onClose();
      })
      .catch(err => {
        setSaving(false);
        if (isConflict(err)) {
          setConflict(true);
        } else {
          setError(formatError(err));
        }
      });
  };

  const handleSave = () => (restartChanges.length > 0 ? setConfirmOpen(true) : apply());

  return (
    <>
      <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
        <DialogTitle>Edit PostgreSQL configuration</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Values use PostgreSQL syntax, units included (for example <code>256MB</code> or{' '}
            <code>5min</code>). They are validated by the operator when you save.
          </Typography>
          {PARAMETER_GROUPS.map(group => (
            <Box key={group.title} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {group.title}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                }}
              >
                {group.parameters.map(spec => (
                  <ParameterField
                    key={spec.name}
                    spec={spec}
                    value={curated[spec.name]}
                    onChange={value => setCurated(prev => ({ ...prev, [spec.name]: value }))}
                  />
                ))}
              </Box>
            </Box>
          ))}

          <Accordion
            disableGutters
            variant="outlined"
            expanded={extrasExpanded || hasExtraErrors}
            onChange={(_, expanded) => setExtrasExpanded(expanded)}
            sx={{ mb: 2 }}
          >
            <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
              <Typography variant="subtitle2">
                Additional parameters ({extras.filter(row => row.key.trim() !== '').length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Any other parameter. Many of these are operator defaults you never set; the operator
                rejects the ones it manages.
              </Typography>
              {extras.map(row => (
                <Box key={row.id} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
                  <TextField
                    size="small"
                    label="Name"
                    value={row.key}
                    onChange={e => updateExtra(row.id, { key: e.target.value })}
                    error={!!extraErrors[row.id]}
                    helperText={extraErrors[row.id]}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label="Value"
                    value={row.value}
                    onChange={e => updateExtra(row.id, { value: e.target.value })}
                    sx={{ flex: 1 }}
                  />
                  <Tooltip title="Remove">
                    <IconButton
                      aria-label={`Remove ${row.key || 'parameter'}`}
                      onClick={() => setExtras(rows => rows.filter(r => r.id !== row.id))}
                    >
                      <Icon icon="mdi:delete-outline" />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))}
              <Button
                size="small"
                startIcon={<Icon icon="mdi:plus" />}
                onClick={() =>
                  setExtras(rows => [...rows, { id: nextId.current++, key: '', value: '' }])
                }
              >
                Add parameter
              </Button>
            </AccordionDetails>
          </Accordion>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Pending changes ({changes.length})
          </Typography>
          {changes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No changes.
            </Typography>
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 3 }}>
              {changes.map(change => (
                <li key={change.key}>
                  <Typography variant="body2" component="span">
                    <code>{change.key}</code>:{' '}
                    {change.from === undefined ? <em>unset</em> : <code>{change.from}</code>} →{' '}
                    {change.to === undefined ? <em>unset</em> : <code>{change.to}</code>}
                  </Typography>
                  {change.restart && (
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      label="restart"
                      sx={{ ml: 1 }}
                    />
                  )}
                </li>
              ))}
            </Box>
          )}

          {restartChanges.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {restartChanges.map(change => change.key).join(', ')}{' '}
              {restartChanges.length === 1 ? 'needs' : 'need'} a restart: the operator will perform
              a rolling update of the instances.
            </Alert>
          )}
          {conflict && (
            <Alert
              severity="warning"
              sx={{ mt: 2 }}
              action={
                <Button color="inherit" size="small" onClick={onReload}>
                  Reload
                </Button>
              }
            >
              This cluster was modified since you opened the editor. Reload to see the latest
              values; your unsaved edits will be discarded.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || conflict || changes.length === 0 || hasExtraErrors}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        handleClose={() => setConfirmOpen(false)}
        title="Restart required"
        description={
          <>
            Changing <strong>{restartChanges.map(change => change.key).join(', ')}</strong> makes
            the operator restart the instances of <strong>{name}</strong> in a rolling update. Do
            you want to continue?
          </>
        }
        onConfirm={() => {
          setConfirmOpen(false);
          apply();
        }}
      />
    </>
  );
}

// Same allowed-until-checked RBAC pattern as scale.tsx: ActionButton has no bare `disabled`
// prop, so the permission check is wired in directly.
function EditAction({ cluster, onClick }: { cluster: Cluster; onClick: () => void }) {
  const [allowed, setAllowed] = useState(true);
  const button = (
    <ActionButton
      description="Edit PostgreSQL configuration"
      icon="mdi:pencil"
      onClick={onClick}
      iconButtonProps={{ disabled: !allowed }}
    />
  );
  return (
    <>
      <AuthVisible
        item={cluster}
        authVerb="patch"
        onAuthResult={({ allowed: result }) => setAllowed(result)}
      >
        {null}
      </AuthVisible>
      {allowed ? (
        button
      ) : (
        <Tooltip title="You don't have permission to edit this cluster.">
          <span>{button}</span>
        </Tooltip>
      )}
    </>
  );
}

export function PostgresqlConfigSection({ cluster }: { cluster: Cluster }) {
  const [open, setOpen] = useState(false);
  // Bumped by "Reload" to remount the dialog, which re-reads the cluster and its resourceVersion.
  const [session, setSession] = useState(0);
  const parameters = cluster.spec.postgresql?.parameters ?? {};
  const keys = Object.keys(parameters).sort();

  return (
    <>
      {/* The tab is already called "PG Configuration", so the box has no title of its own. */}
      <SectionBox>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <EditAction cluster={cluster} onClick={() => setOpen(true)} />
        </Box>
        {keys.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No PostgreSQL parameters set.
          </Typography>
        ) : (
          <NameValueTable rows={keys.map(key => ({ name: key, value: parameters[key] }))} />
        )}
      </SectionBox>
      {open && (
        <EditDialog
          key={session}
          cluster={cluster}
          onClose={() => setOpen(false)}
          onReload={() => setSession(s => s + 1)}
        />
      )}
    </>
  );
}
