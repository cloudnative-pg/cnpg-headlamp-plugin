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
import { KlioServer } from '../../../resources/klioServer';
import { SecretKeyRef } from '../../../resources/objectStore';
import { DryRunState,validateDryRun } from '../../clusters/create/types';
import { AuthDisabledButton } from '../../common/AuthDisabledButton';
import { ImmutableNote } from '../../common/ImmutableNote';
import { RequiredLabel } from '../../common/RequiredLabel';
import { SecretKeySelector } from '../../common/SecretKeySelector';
import { SecretNameSelect } from '../../common/SecretNameSelect';
import { StorageSizeClassFields } from '../../common/StorageSizeClassFields';
import { YamlPreview } from '../../common/YamlPreview';
import {
  buildKlioServerManifest,
  defaultKlioServerFormState,
  deriveKlioServerSummary,
  getKlioServerValidationErrors,
  KlioFileReferenceState,
  KlioServerCreateFormState,
  KlioServerMode,
} from './types';

const { createRouteURL } = Router;

const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

type CreateTab = 'general' | 'tlsauth' | 'tier1' | 'tier2' | 'storage' | 'yaml';

type UpdateFn = (patch: Partial<KlioServerCreateFormState>) => void;

const ACCESS_MODE_OPTIONS = ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany'];

// One encryptionKeyFile/identityFile fileReference: the Secret holding the file plus the path
// inside it. The CRD accepts any VolumeSource here — the YAML override covers the rest.
function FileReferenceFields({
  namespace,
  label,
  value,
  onChange,
  idPrefix,
}: {
  namespace: string;
  label: string;
  value: KlioFileReferenceState;
  onChange: (value: KlioFileReferenceState) => void;
  idPrefix: string;
}) {
  const [secrets] = K8s.ResourceClasses.Secret.useList({ namespace });

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, mt: 2 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <FormControl fullWidth margin="normal">
        <InputLabel id={`${idPrefix}-secret-label`}>
          <RequiredLabel label="Secret" required />
        </InputLabel>
        <Select
          labelId={`${idPrefix}-secret-label`}
          label={<RequiredLabel label="Secret" required />}
          value={value.secretName}
          onChange={e => onChange({ ...value, secretName: e.target.value })}
        >
          {(secrets ?? []).map(secret => (
            <MenuItem key={secret.getName()} value={secret.getName()}>
              {secret.getName()}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        fullWidth
        margin="normal"
        label={<RequiredLabel label="Path" required />}
        placeholder="encryption-key"
        value={value.path}
        onChange={e => onChange({ ...value, path: e.target.value })}
      />
    </Box>
  );
}

interface TabProps {
  state: KlioServerCreateFormState;
  update: UpdateFn;
}

function GeneralTab({ state, update }: TabProps) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const nameInvalid = !!state.name && !NAME_PATTERN.test(state.name);

  return (
    <>
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Server identity">
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
            <InputLabel id="create-klioserver-namespace-label">
              <RequiredLabel label="Namespace" required />
            </InputLabel>
            <Select
              labelId="create-klioserver-namespace-label"
              label={<RequiredLabel label="Namespace" required />}
              value={state.namespace}
              onChange={e =>
                update({
                  namespace: e.target.value,
                  tlsSecretName: '',
                  caSecretName: '',
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

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Mode">
        <FormControl fullWidth margin="normal">
          <InputLabel id="create-klioserver-mode-label">
            <RequiredLabel label="Mode" required />
          </InputLabel>
          <Select
            labelId="create-klioserver-mode-label"
            label={<RequiredLabel label="Mode" required />}
            value={state.mode}
            onChange={e => update({ mode: e.target.value as KlioServerMode })}
          >
            <MenuItem value="standard">Standard — accept backups and WAL, optional Tier 2</MenuItem>
            <MenuItem value="read-only">Read-only — serve Tier 2 only, no writes</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary">
          <ImmutableNote /> A read-only server requires Tier 2 and no Tier 1.
        </Typography>
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Image">
        <TextField
          fullWidth
          margin="normal"
          label={<RequiredLabel label="Image" required />}
          placeholder="ghcr.io/cloudnative-pg/klio:v0.0.20"
          value={state.image}
          onChange={e => update({ image: e.target.value })}
        />
        <FormControl fullWidth margin="normal">
          <InputLabel id="create-klioserver-imagepullpolicy-label">Image Pull Policy</InputLabel>
          <Select
            labelId="create-klioserver-imagepullpolicy-label"
            label="Image Pull Policy"
            value={state.imagePullPolicy}
            onChange={e => update({ imagePullPolicy: e.target.value })}
          >
            <MenuItem value="IfNotPresent">IfNotPresent</MenuItem>
            <MenuItem value="Always">Always</MenuItem>
            <MenuItem value="Never">Never</MenuItem>
          </Select>
        </FormControl>
      </SectionBox>
    </>
  );
}

function TlsAuthTab({ state, update }: TabProps) {
  return (
    <SectionBox headerProps={{ headerStyle: 'normal' }} title="TLS & Authentication">
      <Typography variant="body2" color="text.secondary">
        mTLS between clients and the server: the server presents the TLS secret, and validates
        clients against the CA secret.
      </Typography>
      <SecretNameSelect
        namespace={state.namespace}
        label="TLS Secret"
        value={state.tlsSecretName}
        onChange={tlsSecretName => update({ tlsSecretName })}
        idPrefix="create-klioserver-tls"
        required
      />
      <SecretNameSelect
        namespace={state.namespace}
        label="CA Secret"
        value={state.caSecretName}
        onChange={caSecretName => update({ caSecretName })}
        idPrefix="create-klioserver-ca"
        required
      />
    </SectionBox>
  );
}

function Tier1Tab({ state, update }: TabProps) {
  if (state.mode === 'read-only') {
    return (
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Tier 1 encryption">
        <Alert severity="info">
          Read-only servers have no Tier 1 — key files are configured under Tier 2 instead.
        </Alert>
      </SectionBox>
    );
  }

  return (
    <SectionBox headerProps={{ headerStyle: 'normal' }} title="Tier 1 encryption">
      <Typography variant="body2" color="text.secondary">
        Age-encrypted encryption key plus the identity file that decrypts it. The same pair is
        reused for Tier 2 unless Tier 2 defines its own.
      </Typography>
      <FileReferenceFields
        namespace={state.namespace}
        label="Encryption key file"
        value={state.tier1EncryptionKey}
        onChange={tier1EncryptionKey => update({ tier1EncryptionKey })}
        idPrefix="create-klioserver-tier1-enckey"
      />
      <FileReferenceFields
        namespace={state.namespace}
        label="Identity file"
        value={state.tier1Identity}
        onChange={tier1Identity => update({ tier1Identity })}
        idPrefix="create-klioserver-tier1-identity"
      />
    </SectionBox>
  );
}

function Tier2Tab({ state, update }: TabProps) {
  const readOnly = state.mode === 'read-only';
  const enabled = readOnly || state.tier2Enabled;

  function updateS3(patch: Partial<KlioServerCreateFormState['s3']>) {
    update({ s3: { ...state.s3, ...patch } });
  }

  function updateSecretRef(field: 'accessKeyId' | 'secretAccessKey' | 'customCaBundle') {
    return (value: SecretKeyRef) => updateS3({ [field]: value });
  }

  return (
    <SectionBox headerProps={{ headerStyle: 'normal' }} title="Tier 2 (object store)">
      <FormControlLabel
        control={
          <Checkbox
            checked={enabled}
            disabled={readOnly}
            onChange={e => update({ tier2Enabled: e.target.checked })}
          />
        }
        label={
          readOnly
            ? 'Enabled (required for read-only servers)'
            : 'Enable Tier 2 replication to object storage'
        }
      />
      {enabled && (
        <>
          <FileReferenceFields
            namespace={state.namespace}
            label="Encryption key file"
            value={state.tier2EncryptionKey}
            onChange={tier2EncryptionKey => update({ tier2EncryptionKey })}
            idPrefix="create-klioserver-tier2-enckey"
          />
          <FileReferenceFields
            namespace={state.namespace}
            label="Identity file"
            value={state.tier2Identity}
            onChange={tier2Identity => update({ tier2Identity })}
            idPrefix="create-klioserver-tier2-identity"
          />

          <Typography variant="subtitle1" sx={{ mt: 2 }}>
            S3 configuration
          </Typography>
          <TextField
            fullWidth
            margin="normal"
            label={<RequiredLabel label="Bucket Name" required />}
            value={state.s3.bucketName}
            onChange={e => updateS3({ bucketName: e.target.value })}
          />
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              margin="normal"
              label="Prefix"
              placeholder="klio"
              value={state.s3.prefix}
              onChange={e => updateS3({ prefix: e.target.value })}
              sx={{ flex: 1, minWidth: 160 }}
            />
            <TextField
              margin="normal"
              label="Region"
              placeholder="us-east-1"
              value={state.s3.region}
              onChange={e => updateS3({ region: e.target.value })}
              sx={{ flex: 1, minWidth: 160 }}
            />
          </Box>
          <TextField
            fullWidth
            margin="normal"
            label="Endpoint"
            placeholder="https://s3-compatible:9000 (empty for AWS S3)"
            value={state.s3.endpoint}
            onChange={e => updateS3({ endpoint: e.target.value })}
          />

          <FormControl fullWidth margin="normal">
            <InputLabel id="create-klioserver-s3auth-label">
              <RequiredLabel label="S3 Authentication" required />
            </InputLabel>
            <Select
              labelId="create-klioserver-s3auth-label"
              label={<RequiredLabel label="S3 Authentication" required />}
              value={state.s3.useCredentials ? 'keys' : 'iamRole'}
              onChange={e => updateS3({ useCredentials: e.target.value === 'keys' })}
            >
              <MenuItem value="keys">Access Key / Secret Key</MenuItem>
              <MenuItem value="iamRole">IAM Role (pod role, e.g. IRSA)</MenuItem>
            </Select>
          </FormControl>

          {state.s3.useCredentials && (
            <>
              <SecretKeySelector
                idPrefix="create-klioserver-s3-accesskeyid"
                label="Access Key ID"
                namespace={state.namespace}
                value={state.s3.accessKeyId}
                onChange={updateSecretRef('accessKeyId')}
              />
              <SecretKeySelector
                idPrefix="create-klioserver-s3-secretaccesskey"
                label="Secret Access Key"
                namespace={state.namespace}
                value={state.s3.secretAccessKey}
                onChange={updateSecretRef('secretAccessKey')}
              />
            </>
          )}

          <FormControlLabel
            control={
              <Checkbox
                checked={state.s3.useCustomCa}
                onChange={e => updateS3({ useCustomCa: e.target.checked })}
              />
            }
            label="Custom CA bundle for the endpoint (e.g. self-signed storage cert)"
          />
          {state.s3.useCustomCa && (
            <SecretKeySelector
              idPrefix="create-klioserver-s3-customca"
              label="Custom CA Bundle"
              namespace={state.namespace}
              value={state.s3.customCaBundle}
              onChange={updateSecretRef('customCaBundle')}
            />
          )}
        </>
      )}
    </SectionBox>
  );
}

function StorageTab({ state, update }: TabProps) {
  function toggleAccessMode(mode: string, checked: boolean) {
    update({
      accessModes: checked
        ? [...state.accessModes, mode]
        : state.accessModes.filter(m => m !== mode),
    });
  }

  return (
    <SectionBox headerProps={{ headerStyle: 'normal' }} title="Storage">
      <Typography variant="body2" color="text.secondary">
        Single PVC backing <code>/klio</code> — base backups, WAL, work queue and tier caches.
      </Typography>
      <StorageSizeClassFields
        idPrefix="create-klioserver-storage"
        sizeLabel="Storage Size"
        value={{ size: state.storageSize, storageClass: state.storageClass }}
        onChange={storage =>
          update({ storageSize: storage.size ?? '', storageClass: storage.storageClass })
        }
      />
      <Typography variant="subtitle2" sx={{ mt: 1 }}>
        Access Modes
      </Typography>
      {ACCESS_MODE_OPTIONS.map(mode => (
        <FormControlLabel
          key={mode}
          control={
            <Checkbox
              checked={state.accessModes.includes(mode)}
              onChange={e => toggleAccessMode(mode, e.target.checked)}
            />
          }
          label={mode}
        />
      ))}
    </SectionBox>
  );
}

export function CreateKlioServerPage() {
  const history = useHistory();
  const [tab, setTab] = useState<CreateTab>('general');
  const [state, setState] = useState<KlioServerCreateFormState>(defaultKlioServerFormState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manifestOverride, setManifestOverride] = useState<object | null>(null);
  const [dryRun, setDryRun] = useState<DryRunState>({ status: 'idle' });
  const [dryRunValidating, setDryRunValidating] = useState(false);

  function update(patch: Partial<KlioServerCreateFormState>) {
    setState(prev => ({ ...prev, ...patch }));
  }

  const manifest = useMemo(() => buildKlioServerManifest(state), [state]);
  const summary = useMemo(() => deriveKlioServerSummary(state), [state]);
  const errors = useMemo(() => getKlioServerValidationErrors(state), [state]);
  const canSubmit = errors.length === 0 && !submitting;

  async function handleValidate() {
    setDryRunValidating(true);
    setDryRun({ status: 'validating' });
    const result = await validateDryRun(manifestOverride ?? manifest, (body, queryParams) =>
      KlioServer.apiEndpoint.post(body, queryParams)
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
      await KlioServer.apiEndpoint.post(manifestOverride ?? manifest);
      history.push(
        createRouteURL('CNPG Klio Server', { namespace: state.namespace, name: state.name })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Klio server');
      setSubmitting(false);
    }
  }

  function handleCancel() {
    history.push(createRouteURL('CNPG Klio Servers'));
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
        New Klio Server
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tab}
          onChange={(_, next: CreateTab) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="general" label="General" />
          <Tab value="tlsauth" label="TLS & Authentication" />
          <Tab value="tier1" label="Tier 1" />
          <Tab value="tier2" label="Tier 2" />
          <Tab value="storage" label="Storage" />
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
          {tab === 'tlsauth' && <TlsAuthTab {...tabProps} />}
          {tab === 'tier1' && <Tier1Tab {...tabProps} />}
          {tab === 'tier2' && <Tier2Tab {...tabProps} />}
          {tab === 'storage' && <StorageTab {...tabProps} />}
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
                ['Mode', summary.mode],
                ['Image', summary.image],
                ['Storage', summary.storage],
                ['Tier 1', summary.tier1],
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
              item={KlioServer}
              authVerb="create"
              deniedMessage="You don't have permission to create Klio Servers."
            >
              <Button
                variant="contained"
                color="primary"
                size="small"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                Create server
              </Button>
            </AuthDisabledButton>
          </Box>
        </SectionBox>
      </Box>
    </Box>
  );
}

export function getKlioServerCreateUrl(): string {
  return createRouteURL('CNPG Klio Server New');
}
