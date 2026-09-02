import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useSnackbar } from 'notistack';
import { useMemo, useState } from 'react';
import { BackupMethod, BackupTarget } from '../../resources/backup';
import { Cluster } from '../../resources/cluster';
import { BackupOwnerReference, ScheduledBackup } from '../../resources/scheduledbackup';
import { BackupMethodFields, useBackupMethodState } from '../common/BackupMethodFields';
import { CronScheduleEditor } from '../common/CronScheduleEditor';
import { RequiredLabel } from '../common/RequiredLabel';
import { YamlPreview } from '../common/YamlPreview';

interface ScheduledBackupFormState {
  namespace: string;
  name: string;
  clusterName: string;
  schedule: string;
  backupOwnerReference: BackupOwnerReference;
  immediate: boolean;
  suspend: boolean;
  method: BackupMethod;
  pluginName: string;
  pluginParameters: { key: string; value: string }[];
  target: BackupTarget | '';
}

// Builds the ScheduledBackup manifest from form state — shared by the YAML preview and the actual
// submit call so the two can never drift apart. Mirrors buildBackupManifest in
// components/backups/Create.tsx, plus the schedule/backupOwnerReference/immediate/suspend fields
// that ScheduledBackup has and Backup doesn't.
function buildScheduledBackupManifest(state: ScheduledBackupFormState) {
  const spec: Record<string, any> = {
    schedule: state.schedule,
    cluster: { name: state.clusterName },
    backupOwnerReference: state.backupOwnerReference,
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

  if (state.immediate) {
    spec.immediate = true;
  }

  if (state.suspend) {
    spec.suspend = true;
  }

  return {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'ScheduledBackup',
    metadata: { name: state.name, namespace: state.namespace },
    spec,
  };
}

function ScheduledBackupCreateForm({ onClose }: { onClose: () => void }) {
  const { enqueueSnackbar } = useSnackbar();
  const [clusters] = Cluster.useList();
  const [clusterKey, setClusterKey] = useState('');
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 0 0 * * *');
  const [backupOwnerReference, setBackupOwnerReference] = useState<BackupOwnerReference>('self');
  const [immediate, setImmediate] = useState(false);
  const [suspend, setSuspend] = useState(false);
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
      buildScheduledBackupManifest({
        namespace: selectedCluster?.getNamespace() ?? '',
        name,
        clusterName: selectedCluster?.getName() ?? '',
        schedule,
        backupOwnerReference,
        immediate,
        suspend,
        method,
        pluginName,
        pluginParameters,
        target,
      }),
    [
      selectedCluster,
      name,
      schedule,
      backupOwnerReference,
      immediate,
      suspend,
      method,
      pluginName,
      pluginParameters,
      target,
    ]
  );

  const canSubmit =
    !!selectedCluster &&
    !!name &&
    !!schedule &&
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
      await ScheduledBackup.apiEndpoint.post(manifestOverride ?? manifest);
      enqueueSnackbar(`Created ScheduledBackup "${manifest.metadata.name}"`, {
        variant: 'success',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scheduled backup');
      setSubmitting(false);
    }
  }

  return (
    <SectionBox title="Create Scheduled Backup">
      <FormControl fullWidth margin="normal">
        <InputLabel id="scheduled-backup-cluster-label">
          <RequiredLabel label="Cluster" required />
        </InputLabel>
        <Select
          labelId="scheduled-backup-cluster-label"
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
        placeholder={selectedCluster ? `backup-schedule-${selectedCluster.getName()}` : undefined}
      />

      <CronScheduleEditor value={schedule} onChange={setSchedule} />

      <BackupMethodFields
        idPrefix="scheduled-backup"
        selectedCluster={selectedCluster}
        state={methodState}
      />

      <FormControl fullWidth margin="normal">
        <InputLabel id="scheduled-backup-owner-label">Backup Owner Reference</InputLabel>
        <Select
          labelId="scheduled-backup-owner-label"
          label="Backup Owner Reference"
          value={backupOwnerReference}
          onChange={e => setBackupOwnerReference(e.target.value as BackupOwnerReference)}
        >
          <MenuItem value="self">self (owned by this ScheduledBackup)</MenuItem>
          <MenuItem value="cluster">cluster (owned by the Cluster)</MenuItem>
          <MenuItem value="none">none</MenuItem>
        </Select>
      </FormControl>

      <FormControlLabel
        control={<Switch checked={immediate} onChange={e => setImmediate(e.target.checked)} />}
        label="Run a backup immediately on creation"
        sx={{ mt: 1, display: 'block' }}
      />

      <FormControlLabel
        control={<Switch checked={suspend} onChange={e => setSuspend(e.target.checked)} />}
        label="Suspend (create the schedule without running it yet)"
        sx={{ display: 'block' }}
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

// Opens the create form in an overlay, same convention as launchBackupCreate / launchPoolerCreate
// / launchObjectStoreCreate / launchClusterCreate.
export function launchScheduledBackupCreate() {
  const activityId = 'cnpg-scheduled-backup-create';
  Activity.launch({
    id: activityId,
    title: 'Create Scheduled Backup',
    icon: <Icon icon="mdi:plus-circle" width="100%" height="100%" />,
    location: 'split-right',
    content: <ScheduledBackupCreateForm onClose={() => Activity.close(activityId)} />,
  });
}
