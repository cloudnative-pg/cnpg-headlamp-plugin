import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useSnackbar } from 'notistack';
import { useMemo, useState } from 'react';
import { Backup, BackupMethod, BackupTarget } from '../../resources/backup';
import { Cluster } from '../../resources/cluster';
import { BackupMethodFields, useBackupMethodState } from '../common/BackupMethodFields';
import { RequiredLabel } from '../common/RequiredLabel';
import { YamlPreview } from '../common/YamlPreview';

interface BackupFormState {
  namespace: string;
  name: string;
  clusterName: string;
  method: BackupMethod;
  pluginName: string;
  pluginParameters: { key: string; value: string }[];
  target: BackupTarget | '';
}

// Builds the Backup manifest from form state — shared by the YAML preview and the actual submit
// so the two can never drift apart.
function buildBackupManifest(state: BackupFormState) {
  const spec: Record<string, any> = {
    cluster: { name: state.clusterName },
    method: state.method,
  };

  if (state.method === 'plugin' && state.pluginName) {
    const parameters = state.pluginParameters
      .map(p => ({ key: p.key.trim(), value: p.value }))
      .filter(p => p.key)
      .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.key]: p.value }), {});
    spec.pluginConfiguration = {
      name: state.pluginName,
      ...(Object.keys(parameters).length > 0 && { parameters }),
    };
  }

  if (state.target) {
    spec.target = state.target;
  }

  return {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Backup',
    metadata: { name: state.name, namespace: state.namespace },
    spec,
  };
}

function BackupCreateForm({ onClose }: { onClose: () => void }) {
  const { enqueueSnackbar } = useSnackbar();
  const [clusters] = Cluster.useList();
  const [clusterKey, setClusterKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set while the YamlPreview's "Edit" switch is on — takes precedence over the form-derived
  // manifest below at submit time. See YamlPreview.tsx for why this is an override rather than
  // something synced back onto the form fields.
  const [manifestOverride, setManifestOverride] = useState<object | null>(null);

  const selectedCluster = clusters?.find(
    cluster => `${cluster.getNamespace()}/${cluster.getName()}` === clusterKey
  );

  const methodState = useBackupMethodState(selectedCluster);
  const { method, pluginName, pluginParameters, target, hasAnyMethod } = methodState;

  const manifest = useMemo(
    () =>
      buildBackupManifest({
        namespace: selectedCluster?.getNamespace() ?? '',
        name,
        clusterName: selectedCluster?.getName() ?? '',
        method,
        pluginName,
        pluginParameters,
        target,
      }),
    [selectedCluster, name, method, pluginName, pluginParameters, target]
  );

  const canSubmit =
    !!selectedCluster &&
    !!name &&
    hasAnyMethod &&
    (method !== 'plugin' || !!pluginName) &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await Backup.apiEndpoint.post(manifestOverride ?? manifest);
      enqueueSnackbar(`Created Backup "${manifest.metadata.name}"`, { variant: 'success' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
      setSubmitting(false);
    }
  }

  return (
    <SectionBox title="Create Backup">
      <FormControl fullWidth margin="normal">
        <InputLabel id="backup-cluster-label">
          <RequiredLabel label="Cluster" required />
        </InputLabel>
        <Select
          labelId="backup-cluster-label"
          label={<RequiredLabel label="Cluster" required />}
          value={clusterKey}
          onChange={e => setClusterKey(e.target.value)}
        >
          {(clusters ?? []).map(cluster => {
            const key = `${cluster.getNamespace()}/${cluster.getName()}`;
            return (
              <MenuItem key={key} value={key}>
                {key}
              </MenuItem>
            );
          })}
        </Select>
      </FormControl>

      <TextField
        fullWidth
        margin="normal"
        label={<RequiredLabel label="Name" required />}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={selectedCluster ? `backup-${selectedCluster.getName()}` : undefined}
      />

      <BackupMethodFields idPrefix="backup" selectedCluster={selectedCluster} state={methodState} />

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

// Opens the create form in an overlay, same convention as launchPoolerCreate /
// launchObjectStoreCreate / launchClusterCreate.
export function launchBackupCreate() {
  const activityId = 'cnpg-backup-create';
  Activity.launch({
    id: activityId,
    title: 'Create Backup',
    icon: <Icon icon="mdi:plus-circle" width="100%" height="100%" />,
    location: 'split-right',
    content: <BackupCreateForm onClose={() => Activity.close(activityId)} />,
  });
}
