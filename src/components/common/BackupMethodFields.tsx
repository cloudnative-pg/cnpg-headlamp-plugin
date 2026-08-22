import { Icon } from '@iconify/react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { BackupMethod, BackupTarget } from '../../resources/backup';
import { Cluster } from '../../resources/cluster';
import { RequiredLabel } from './RequiredLabel';

/**
 * Shared method/plugin/target sub-form state for Backup and ScheduledBackup create forms — both
 * resources expose the same spec.method/spec.pluginConfiguration/spec.target fields, gated on
 * what the selected Cluster actually has configured.
 */
export function useBackupMethodState(selectedCluster: Cluster | undefined) {
  const [method, setMethod] = useState<BackupMethod>('plugin');
  const [pluginName, setPluginName] = useState('');
  const [pluginParameters, setPluginParameters] = useState<{ key: string; value: string }[]>([]);
  const [target, setTarget] = useState<BackupTarget | ''>('');

  const clusterPlugins = selectedCluster?.spec.plugins ?? [];
  const hasPlugins = clusterPlugins.length > 0;
  const hasVolumeSnapshot = !!selectedCluster?.volumeSnapshotClassName;
  const hasAnyMethod = hasPlugins || hasVolumeSnapshot;

  // Keep the selected method/plugin valid as the selected cluster changes — e.g. switching to a
  // cluster with no volume-snapshot class configured while "volumeSnapshot" was selected.
  useEffect(() => {
    if (!selectedCluster) {
      return;
    }
    if (method === 'plugin' && !hasPlugins && hasVolumeSnapshot) {
      setMethod('volumeSnapshot');
    } else if (method === 'volumeSnapshot' && !hasVolumeSnapshot && hasPlugins) {
      setMethod('plugin');
    }
    if (method === 'plugin' && !clusterPlugins.some(plugin => plugin.name === pluginName)) {
      setPluginName(clusterPlugins[0]?.name ?? '');
      setPluginParameters([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCluster, hasPlugins, hasVolumeSnapshot]);

  return {
    method,
    setMethod,
    pluginName,
    setPluginName,
    pluginParameters,
    setPluginParameters,
    target,
    setTarget,
    clusterPlugins,
    hasPlugins,
    hasVolumeSnapshot,
    hasAnyMethod,
  };
}

export type BackupMethodState = ReturnType<typeof useBackupMethodState>;

export function BackupMethodFields({
  idPrefix,
  selectedCluster,
  state,
}: {
  idPrefix: string;
  selectedCluster: Cluster | undefined;
  state: BackupMethodState;
}) {
  const {
    method,
    setMethod,
    pluginName,
    setPluginName,
    pluginParameters,
    setPluginParameters,
    target,
    setTarget,
    clusterPlugins,
    hasPlugins,
    hasVolumeSnapshot,
    hasAnyMethod,
  } = state;

  function updateParam(index: number, field: 'key' | 'value', val: string) {
    setPluginParameters(prev => prev.map((p, i) => (i === index ? { ...p, [field]: val } : p)));
  }

  function removeParam(index: number) {
    setPluginParameters(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <>
      {selectedCluster && !hasAnyMethod && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          This cluster has no backup method configured — enable backups or volume snapshots when
          creating/editing the cluster first.
        </Alert>
      )}

      <FormControl fullWidth margin="normal" disabled={!hasAnyMethod}>
        <InputLabel id={`${idPrefix}-method-label`}>
          <RequiredLabel label="Method" required />
        </InputLabel>
        <Select
          labelId={`${idPrefix}-method-label`}
          label={<RequiredLabel label="Method" required />}
          value={method}
          onChange={e => setMethod(e.target.value as BackupMethod)}
        >
          <MenuItem value="plugin" disabled={!hasPlugins}>
            Plugin
          </MenuItem>
          <MenuItem value="volumeSnapshot" disabled={!hasVolumeSnapshot}>
            Volume snapshot
          </MenuItem>
        </Select>
      </FormControl>

      {method === 'plugin' && (
        <>
          <FormControl fullWidth margin="normal" disabled={!hasPlugins}>
            <InputLabel id={`${idPrefix}-plugin-label`}>
              <RequiredLabel label="Plugin" required />
            </InputLabel>
            <Select
              labelId={`${idPrefix}-plugin-label`}
              label={<RequiredLabel label="Plugin" required />}
              value={pluginName}
              onChange={e => {
                setPluginName(e.target.value);
                setPluginParameters([]);
              }}
            >
              {clusterPlugins.map(plugin => (
                <MenuItem key={plugin.name} value={plugin.name}>
                  {plugin.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Plugin Configuration Parameters
            </Typography>
            {pluginParameters.map((param, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="Key"
                  value={param.key}
                  onChange={e => updateParam(index, 'key', e.target.value)}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label="Value"
                  value={param.value}
                  onChange={e => updateParam(index, 'value', e.target.value)}
                  sx={{ flex: 1 }}
                />
                <IconButton
                  size="small"
                  onClick={() => removeParam(index)}
                  aria-label="Remove parameter"
                >
                  <Icon icon="mdi:close" />
                </IconButton>
              </Box>
            ))}
            <IconButton
              size="small"
              onClick={() => setPluginParameters(prev => [...prev, { key: '', value: '' }])}
              aria-label="Add parameter"
            >
              <Icon icon="mdi:plus" />
            </IconButton>
          </Box>
        </>
      )}

      <FormControl fullWidth margin="normal">
        <InputLabel id={`${idPrefix}-target-label`}>Target</InputLabel>
        <Select
          labelId={`${idPrefix}-target-label`}
          label="Target"
          value={target}
          onChange={e => setTarget(e.target.value as BackupTarget | '')}
        >
          <MenuItem value="">Cluster default</MenuItem>
          <MenuItem value="primary">primary</MenuItem>
          <MenuItem value="prefer-standby">prefer-standby</MenuItem>
        </Select>
      </FormControl>
    </>
  );
}
