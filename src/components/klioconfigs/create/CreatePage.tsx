import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { PluginConfiguration } from '../../../resources/pluginConfiguration';
import { DryRunState,validateDryRun } from '../../clusters/create/types';
import { AuthDisabledButton } from '../../common/AuthDisabledButton';
import { ImmutableNote } from '../../common/ImmutableNote';
import { RequiredLabel } from '../../common/RequiredLabel';
import { SecretNameSelect } from '../../common/SecretNameSelect';
import { YamlPreview } from '../../common/YamlPreview';
import {
  buildKlioConfigManifest,
  defaultKlioConfigFormState,
  deriveKlioConfigSummary,
  getKlioConfigValidationErrors,
  KlioConfigCreateFormState,
  KlioConfigMode,
  KlioRetentionFormState,
  RETENTION_LEVELS,
} from './types';

const { createRouteURL } = Router;

const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

type CreateTab = 'general' | 'retention' | 'tuning' | 'yaml';

type UpdateFn = (patch: Partial<KlioConfigCreateFormState>) => void;

// Six keep* numeric fields for one tier's retention policy. '' means "unset" (the Kopia
// default applies); 0 disables that level.
function RetentionEditor({
  value,
  onChange,
  disabled,
}: {
  value: KlioRetentionFormState;
  onChange: (value: KlioRetentionFormState) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {RETENTION_LEVELS.map(level => (
        <TextField
          key={level}
          margin="normal"
          label={level}
          type="number"
          inputProps={{ min: 0 }}
          disabled={disabled}
          value={value[level]}
          onChange={e => onChange({ ...value, [level]: e.target.value })}
          sx={{ flex: 1, minWidth: 140 }}
        />
      ))}
    </Box>
  );
}

interface TabProps {
  state: KlioConfigCreateFormState;
  update: UpdateFn;
}

function GeneralTab({ state, update }: TabProps) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const nameInvalid = !!state.name && !NAME_PATTERN.test(state.name);

  return (
    <>
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Config identity">
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            fullWidth
            margin="normal"
            label={<RequiredLabel label="Name" required />}
            value={state.name}
            onChange={e => update({ name: e.target.value })}
            error={nameInvalid}
            helperText="Lowercase letters, numbers and hyphens only."
            sx={{ flex: 1, minWidth: 200 }}
          />
          <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 200 }}>
            <InputLabel id="create-klioconfig-namespace-label">
              <RequiredLabel label="Namespace" required />
            </InputLabel>
            <Select
              labelId="create-klioconfig-namespace-label"
              label={<RequiredLabel label="Namespace" required />}
              value={state.namespace}
              onChange={e =>
                update({
                  namespace: e.target.value,
                  clientSecretName: '',
                  serverSecretName: '',
                })
              }
            >
              {(namespaces ?? []).map(ns => (
                <MenuItem key={ns.getName()} value={ns.getName()}>
                  {ns.getName()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Server connection">
        <TextField
          fullWidth
          margin="normal"
          label={<RequiredLabel label="Server Address" required />}
          placeholder="server-sample.default"
          helperText="Service name, FQDN or external address. Base backups use port 51515, WAL streaming 52000."
          value={state.serverAddress}
          onChange={e => update({ serverAddress: e.target.value })}
        />
        <TextField
          fullWidth
          margin="normal"
          label={<RequiredLabel label="Cluster Name" required />}
          placeholder="cluster-example"
          value={state.clusterName}
          onChange={e => update({ clusterName: e.target.value })}
        />
        <Alert severity="warning" sx={{ mt: 1 }}>
          Must be unique among all clusters using the same Klio server, across namespaces —
          otherwise WAL streaming is rejected with a system-ID mismatch.
        </Alert>
        <FormControl fullWidth margin="normal">
          <InputLabel id="create-klioconfig-mode-label">
            <RequiredLabel label="Mode" required />
          </InputLabel>
          <Select
            labelId="create-klioconfig-mode-label"
            label={<RequiredLabel label="Mode" required />}
            value={state.mode}
            onChange={e => update({ mode: e.target.value as KlioConfigMode })}
          >
            <MenuItem value="standard">Standard — backup and restore</MenuItem>
            <MenuItem value="read-only">Read-only — restore from Tier 2 only</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary">
          <ImmutableNote /> Read-only configs recover from Tier 2 only — no Tier 1, no backups.
        </Typography>
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Credentials">
        <SecretNameSelect
          namespace={state.namespace}
          label="Client Secret"
          value={state.clientSecretName}
          onChange={clientSecretName => update({ clientSecretName })}
          idPrefix="create-klioconfig-client"
          required
        />
        <SecretNameSelect
          namespace={state.namespace}
          label="Server Secret"
          value={state.serverSecretName}
          onChange={serverSecretName => update({ serverSecretName })}
          idPrefix="create-klioconfig-server"
          required
        />
      </SectionBox>
    </>
  );
}

function RetentionTab({ state, update }: TabProps) {
  const readOnly = state.mode === 'read-only';

  return (
    <>
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Tier 1 retention">
        {readOnly ? (
          <Alert severity="info">Tier 1 is not available in read-only mode.</Alert>
        ) : (
          <RetentionEditor
            value={state.tier1Retention}
            onChange={tier1Retention => update({ tier1Retention })}
          />
        )}
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Tier 2">
        <FormControlLabel
          control={
            <Checkbox
              checked={readOnly ? false : state.tier2EnableBackup}
              disabled={readOnly}
              onChange={e => update({ tier2EnableBackup: e.target.checked })}
            />
          }
          label={
            readOnly
              ? 'Enable backups to Tier 2 (not allowed in read-only mode)'
              : 'Enable backups to Tier 2'
          }
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={readOnly ? true : state.tier2EnableRecovery}
              disabled={readOnly}
              onChange={e => update({ tier2EnableRecovery: e.target.checked })}
            />
          }
          label={
            readOnly
              ? 'Enable recovery from Tier 2 (required in read-only mode)'
              : 'Enable recovery from Tier 2'
          }
        />
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          Tier 2 retention
        </Typography>
        <RetentionEditor
          value={state.tier2Retention}
          onChange={tier2Retention => update({ tier2Retention })}
        />
      </SectionBox>
    </>
  );
}

function TuningTab({ state, update }: TabProps) {
  return (
    <>
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="WAL prefetch">
        <Typography variant="body2" color="text.secondary">
          Downloads upcoming WAL files in the background during recovery. 0 disables prefetching.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            margin="normal"
            label="Prefetch Count"
            placeholder="2"
            type="number"
            inputProps={{ min: 0 }}
            value={state.walPrefetchCount}
            onChange={e => update({ walPrefetchCount: e.target.value })}
            sx={{ flex: 1, minWidth: 160 }}
          />
          <TextField
            margin="normal"
            label="Max Concurrent Downloads"
            placeholder="4"
            type="number"
            inputProps={{ min: 0 }}
            value={state.walPrefetchMaxConcurrent}
            onChange={e => update({ walPrefetchMaxConcurrent: e.target.value })}
            sx={{ flex: 1, minWidth: 160 }}
          />
        </Box>
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Profiling">
        <FormControlLabel
          control={
            <Checkbox checked={state.pprof} onChange={e => update({ pprof: e.target.checked })} />
          }
          label="Enable pprof endpoint"
        />
        <Typography variant="body2" color="text.secondary">
          Only for development or active troubleshooting — not for production.
        </Typography>
      </SectionBox>
    </>
  );
}

export function CreateKlioConfigPage() {
  const history = useHistory();
  const [tab, setTab] = useState<CreateTab>('general');
  const [state, setState] = useState<KlioConfigCreateFormState>(defaultKlioConfigFormState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manifestOverride, setManifestOverride] = useState<object | null>(null);
  const [dryRun, setDryRun] = useState<DryRunState>({ status: 'idle' });
  const [dryRunValidating, setDryRunValidating] = useState(false);

  function update(patch: Partial<KlioConfigCreateFormState>) {
    setState(prev => ({ ...prev, ...patch }));
  }

  const manifest = useMemo(() => buildKlioConfigManifest(state), [state]);
  const summary = useMemo(() => deriveKlioConfigSummary(state), [state]);
  const errors = useMemo(() => getKlioConfigValidationErrors(state), [state]);
  const canSubmit = errors.length === 0 && !submitting;

  async function handleValidate() {
    setDryRunValidating(true);
    setDryRun({ status: 'validating' });
    const result = await validateDryRun(manifestOverride ?? manifest, (body, queryParams) =>
      PluginConfiguration.apiEndpoint.post(body, queryParams)
    );
    setDryRun(result);
    setDryRunValidating(false);
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await PluginConfiguration.apiEndpoint.post(manifestOverride ?? manifest);
      history.push(
        createRouteURL('CNPG Klio Config', { namespace: state.namespace, name: state.name })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Klio client config');
      setSubmitting(false);
    }
  }

  function handleCancel() {
    history.push(createRouteURL('CNPG Klio Configs'));
  }

  const tabProps: TabProps = { state, update };

  return (
    <Box
      sx={{
        maxWidth: 1280,
        mx: 'auto',
        pb: 2,
        pt: 2,
        // Halve the gap between each section title and its content (Headlamp's
        // SectionHeader pads all around by default). Scoped to this page, whose
        // only Grid containers are those headers.
        '& .MuiGrid-container': { paddingBottom: 1 },
      }}
    >
      <Typography variant="h1" component="h1" sx={{ mb: 2 }}>
        New Klio Client Config
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tab}
          onChange={(_, next: CreateTab) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="general" label="General" />
          <Tab value="retention" label="Retention" />
          <Tab value="tuning" label="Tuning" />
          <Tab value="yaml" label="YAML Preview" sx={{ fontWeight: 700 }} />
        </Tabs>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: '1fr 340px' },
          alignItems: 'start',
          mt: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {tab === 'general' && <GeneralTab {...tabProps} />}
          {tab === 'retention' && <RetentionTab {...tabProps} />}
          {tab === 'tuning' && <TuningTab {...tabProps} />}
          {tab === 'yaml' && (
            <SectionBox headerProps={{ headerStyle: 'normal' }} title="YAML Preview">
              <YamlPreview
                manifest={manifest}
                onOverrideChange={setManifestOverride}
                defaultExpanded
              />
            </SectionBox>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Box>

        <SectionBox
          headerProps={{ headerStyle: 'normal' }}
          title="Summary"
          sx={{ position: { lg: 'sticky' }, top: { lg: 16 } }}
        >
          <Box
            component="dl"
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              rowGap: 1,
              columnGap: 2,
              m: 0,
              fontSize: 13,
            }}
          >
            {(
              [
                ['Name', summary.name],
                ['Server', summary.server],
                ['Cluster', summary.cluster],
                ['Mode', summary.mode],
                ['Tier 2', summary.tier2],
              ] as [string, string][]
            ).map(([term, value]) => (
              <Box key={term} sx={{ display: 'contents' }}>
                <Typography component="dt" variant="body2" color="text.secondary">
                  {term}
                </Typography>
                <Typography
                  component="dd"
                  variant="body2"
                  sx={{ m: 0, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}
                >
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
          {dryRun.status === 'idle' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Not validated yet — form checks only. Dry-run is on demand.
            </Alert>
          )}
          {dryRun.status === 'validating' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Validating via dry-run…
            </Alert>
          )}
          {dryRun.status === 'passed' && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Dry-run passed.
            </Alert>
          )}
          {dryRun.status === 'failed' && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Dry-run failed: {dryRun.errors.join('; ')}
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              disabled={dryRunValidating}
              onClick={handleValidate}
            >
              Validate via dry-run
            </Button>
            <Button variant="outlined" size="small" onClick={handleCancel}>
              Cancel
            </Button>
            <AuthDisabledButton
              item={PluginConfiguration}
              authVerb="create"
              deniedMessage="You don't have permission to create Klio Client Configs."
            >
              <Button
                variant="contained"
                color="primary"
                size="small"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                Create config
              </Button>
            </AuthDisabledButton>
          </Box>
        </SectionBox>
      </Box>
    </Box>
  );
}

export function getKlioConfigCreateUrl(): string {
  return createRouteURL('CNPG Klio Config New');
}
