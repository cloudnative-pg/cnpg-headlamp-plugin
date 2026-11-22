import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { ObjectStore, SecretKeyRef } from '../../resources/objectStore';
import { NamespaceField } from '../common/NamespaceField';
import { RequiredLabel } from '../common/RequiredLabel';
import { SecretKeySelector } from '../common/SecretKeySelector';
import { YamlPreview } from '../common/YamlPreview';

type S3AuthMethod = 'keys' | 'iamRole';
type WalCompression = '' | 'bzip2' | 'gzip' | 'lz4' | 'snappy' | 'xz' | 'zstd';

// Backups and WALs, e.g. '30d', '4w', '6m'.
const RETENTION_POLICY_PATTERN = /^[1-9][0-9]*[dwm]$/;

const emptySecretKeyRef: SecretKeyRef = { name: '', key: '' };

interface ObjectStoreFormState {
  namespace: string;
  name: string;
  destinationPath: string;
  endpointURL: string;
  useEndpointCA: boolean;
  endpointCA: SecretKeyRef;
  authMethod: S3AuthMethod;
  accessKeyId: SecretKeyRef;
  secretAccessKey: SecretKeyRef;
  useRegion: boolean;
  region: SecretKeyRef;
  retentionPolicy: string;
  walCompression: WalCompression;
  walMaxParallel: string;
}

// Builds the ObjectStore manifest from form state — shared by the YAML preview and the actual
// submit so the two can never drift apart.
function buildObjectStoreManifest(state: ObjectStoreFormState) {
  const configuration: Record<string, any> = { destinationPath: state.destinationPath };
  if (state.endpointURL) {
    configuration.endpointURL = state.endpointURL;
  }
  if (state.useEndpointCA && state.endpointCA.name && state.endpointCA.key) {
    configuration.endpointCA = state.endpointCA;
  }
  if (state.authMethod === 'iamRole') {
    configuration.s3Credentials = { inheritFromIAMRole: true };
  } else {
    configuration.s3Credentials = {
      accessKeyId: state.accessKeyId,
      secretAccessKey: state.secretAccessKey,
    };
    if (state.useRegion && state.region.name && state.region.key) {
      configuration.s3Credentials.region = state.region;
    }
  }
  if (state.walCompression || state.walMaxParallel) {
    configuration.wal = {
      ...(state.walCompression && { compression: state.walCompression }),
      ...(state.walMaxParallel && { maxParallel: Number(state.walMaxParallel) }),
    };
  }

  const spec: Record<string, any> = { configuration };
  if (state.retentionPolicy) {
    spec.retentionPolicy = state.retentionPolicy;
  }

  return {
    apiVersion: 'barmancloud.cnpg.io/v1',
    kind: 'ObjectStore',
    metadata: { name: state.name, namespace: state.namespace },
    spec,
  };
}

function ObjectStoreCreateForm({ onClose }: { onClose: () => void }) {
  const [namespace, setNamespace] = useState('');
  const [name, setName] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [endpointURL, setEndpointURL] = useState('');
  const [endpointCA, setEndpointCA] = useState<SecretKeyRef>(emptySecretKeyRef);
  const [useEndpointCA, setUseEndpointCA] = useState(false);
  const [authMethod, setAuthMethod] = useState<S3AuthMethod>('keys');
  const [accessKeyId, setAccessKeyId] = useState<SecretKeyRef>(emptySecretKeyRef);
  const [secretAccessKey, setSecretAccessKey] = useState<SecretKeyRef>(emptySecretKeyRef);
  const [region, setRegion] = useState<SecretKeyRef>(emptySecretKeyRef);
  const [useRegion, setUseRegion] = useState(false);
  const [retentionPolicy, setRetentionPolicy] = useState('');
  const [walCompression, setWalCompression] = useState<WalCompression>('');
  const [walMaxParallel, setWalMaxParallel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set while the YamlPreview's "Edit" switch is on — takes precedence over the form-derived
  // manifest below at submit time. See YamlPreview.tsx for why this is an override rather than
  // something synced back onto the form fields.
  const [manifestOverride, setManifestOverride] = useState<object | null>(null);

  const retentionPolicyValid = !retentionPolicy || RETENTION_POLICY_PATTERN.test(retentionPolicy);
  const credentialsValid =
    authMethod === 'iamRole' ||
    (accessKeyId.name && accessKeyId.key && secretAccessKey.name && secretAccessKey.key);
  const canSubmit =
    !!namespace &&
    !!name &&
    !!destinationPath &&
    retentionPolicyValid &&
    credentialsValid &&
    !submitting;

  const manifest = useMemo(
    () =>
      buildObjectStoreManifest({
        namespace,
        name,
        destinationPath,
        endpointURL,
        useEndpointCA,
        endpointCA,
        authMethod,
        accessKeyId,
        secretAccessKey,
        useRegion,
        region,
        retentionPolicy,
        walCompression,
        walMaxParallel,
      }),
    [
      namespace,
      name,
      destinationPath,
      endpointURL,
      useEndpointCA,
      endpointCA,
      authMethod,
      accessKeyId,
      secretAccessKey,
      useRegion,
      region,
      retentionPolicy,
      walCompression,
      walMaxParallel,
    ]
  );

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ObjectStore.apiEndpoint.post(manifestOverride ?? manifest);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create object store');
      setSubmitting(false);
    }
  }

  return (
    <SectionBox title="Create ObjectStore">
      <NamespaceField idPrefix="objectstore" value={namespace} onChange={setNamespace} />

      <TextField
        fullWidth
        margin="normal"
        label={<RequiredLabel label="Name" required />}
        value={name}
        onChange={e => setName(e.target.value)}
      />

      <TextField
        fullWidth
        margin="normal"
        label={<RequiredLabel label="Destination Path" required />}
        placeholder="s3://bucket/path/to/folder"
        value={destinationPath}
        onChange={e => setDestinationPath(e.target.value)}
      />

      <TextField
        fullWidth
        margin="normal"
        label="Endpoint URL"
        placeholder="https://minio:9000 (leave empty to use AWS S3's default endpoint)"
        value={endpointURL}
        onChange={e => setEndpointURL(e.target.value)}
      />

      <FormControlLabel
        control={
          <Checkbox checked={useEndpointCA} onChange={e => setUseEndpointCA(e.target.checked)} />
        }
        label="Custom CA certificate for the endpoint (e.g. self-signed Minio cert)"
      />
      {useEndpointCA && (
        <SecretKeySelector
          idPrefix="objectstore-endpointca"
          label="Endpoint CA"
          namespace={namespace}
          value={endpointCA}
          onChange={setEndpointCA}
        />
      )}

      <FormControl fullWidth margin="normal">
        <InputLabel id="objectstore-authmethod-label">
          <RequiredLabel label="S3 Authentication" required />
        </InputLabel>
        <Select
          labelId="objectstore-authmethod-label"
          label={<RequiredLabel label="S3 Authentication" required />}
          value={authMethod}
          onChange={e => setAuthMethod(e.target.value as S3AuthMethod)}
        >
          <MenuItem value="keys">Access Key / Secret Key</MenuItem>
          <MenuItem value="iamRole">IAM Role (inherit from the instance's role)</MenuItem>
        </Select>
      </FormControl>

      {authMethod === 'keys' && (
        <>
          <SecretKeySelector
            idPrefix="objectstore-accesskeyid"
            label="Access Key ID"
            namespace={namespace}
            value={accessKeyId}
            onChange={setAccessKeyId}
          />
          <SecretKeySelector
            idPrefix="objectstore-secretaccesskey"
            label="Secret Access Key"
            namespace={namespace}
            value={secretAccessKey}
            onChange={setSecretAccessKey}
          />
          <FormControlLabel
            control={
              <Checkbox checked={useRegion} onChange={e => setUseRegion(e.target.checked)} />
            }
            label="Region"
          />
          {useRegion && (
            <SecretKeySelector
              idPrefix="objectstore-region"
              label="Region"
              namespace={namespace}
              value={region}
              onChange={setRegion}
            />
          )}
        </>
      )}

      <TextField
        fullWidth
        margin="normal"
        label="Retention Policy"
        placeholder="30d"
        value={retentionPolicy}
        onChange={e => setRetentionPolicy(e.target.value)}
        error={!retentionPolicyValid}
        helperText={
          retentionPolicyValid
            ? "A positive integer followed by 'd', 'w', or 'm' (days/weeks/months)."
            : "Must match a positive integer followed by 'd', 'w', or 'm', e.g. 30d."
        }
      />

      <Typography variant="subtitle1" sx={{ mt: 2 }}>
        WAL archive tuning
      </Typography>

      <FormControl fullWidth margin="normal">
        <InputLabel id="objectstore-wal-compression-label">WAL Compression</InputLabel>
        <Select
          labelId="objectstore-wal-compression-label"
          label="WAL Compression"
          value={walCompression}
          onChange={e => setWalCompression(e.target.value as WalCompression)}
        >
          <MenuItem value="">None</MenuItem>
          <MenuItem value="bzip2">bzip2</MenuItem>
          <MenuItem value="gzip">gzip</MenuItem>
          <MenuItem value="lz4">lz4</MenuItem>
          <MenuItem value="snappy">snappy</MenuItem>
          <MenuItem value="xz">xz</MenuItem>
          <MenuItem value="zstd">zstd</MenuItem>
        </Select>
      </FormControl>

      <TextField
        fullWidth
        margin="normal"
        label="WAL Max Parallel"
        type="number"
        inputProps={{ min: 1 }}
        value={walMaxParallel}
        onChange={e => setWalMaxParallel(e.target.value)}
      />

      <YamlPreview manifest={manifest} onOverrideChange={setManifestOverride} />

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}

      <Button
        variant="contained"
        color="primary"
        sx={{ mt: 2 }}
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        Create
      </Button>
    </SectionBox>
  );
}

// Opens the create form in an overlay, same convention as launchPoolerCreate in
// components/poolers/Create.tsx.
export function launchObjectStoreCreate() {
  const activityId = 'cnpg-objectstore-create';
  Activity.launch({
    id: activityId,
    title: 'Create ObjectStore',
    icon: <Icon icon="mdi:plus-circle" width="100%" height="100%" />,
    location: 'split-right',
    content: <ObjectStoreCreateForm onClose={() => Activity.close(activityId)} />,
  });
}
