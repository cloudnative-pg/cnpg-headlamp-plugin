import { K8s } from '@kinvolk/headlamp-plugin/lib';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { StorageConfiguration } from '../../resources/cluster';
import { RequiredLabel } from './RequiredLabel';

interface StorageSizeClassFieldsProps {
  value: StorageConfiguration;
  onChange: (value: StorageConfiguration) => void;
  idPrefix: string;
  sizeLabel?: string;
  sizeRequired?: boolean;
}

const CUSTOM_VALUE = '__custom__';

// A {size, storageClass} pair, used wherever the Cluster spec expects a StorageConfiguration
// (PGData, WAL storage, each tablespace). storageClass is optional — leaving it unset means "use
// the cluster's default storage class". Offers a "Custom name…" free-text entry for classes the
// list doesn't show, and falls back to a plain text field when the StorageClass list itself
// can't be loaded (e.g. the user lacks cluster-level list permission).
export function StorageSizeClassFields({
  value,
  onChange,
  idPrefix,
  sizeLabel = 'Size',
  sizeRequired = true,
}: StorageSizeClassFieldsProps) {
  const [storageClasses, storageClassesError] = K8s.ResourceClasses.StorageClass.useList();
  const [customMode, setCustomMode] = useState(false);

  const knownNames = new Set((storageClasses ?? []).map(sc => sc.getName()));
  // A class set elsewhere (e.g. an existing object) that isn't in the listed names is
  // treated as custom so the select doesn't silently reset it to "Cluster default".
  const isCustomValue =
    !!value.storageClass && !knownNames.has(value.storageClass) && storageClasses !== null;
  const showCustom = customMode || isCustomValue || !!storageClassesError;

  return (
    <>
      <TextField
        fullWidth
        margin="normal"
        label={<RequiredLabel label={sizeLabel} required={sizeRequired} />}
        placeholder="1Gi"
        value={value.size ?? ''}
        onChange={e => onChange({ ...value, size: e.target.value })}
      />

      {showCustom ? (
        <TextField
          fullWidth
          margin="normal"
          label="Storage Class"
          placeholder="Cluster default"
          helperText={
            storageClassesError
              ? 'StorageClass list unavailable — type a class name, or leave empty for the cluster default.'
              : 'Type a storage class name, or leave empty for the cluster default.'
          }
          value={value.storageClass ?? ''}
          onChange={e => onChange({ ...value, storageClass: e.target.value || undefined })}
        />
      ) : (
        <FormControl fullWidth margin="normal">
          <InputLabel id={`${idPrefix}-storageclass-label`}>Storage Class</InputLabel>
          <Select
            labelId={`${idPrefix}-storageclass-label`}
            label="Storage Class"
            value={value.storageClass ?? ''}
            onChange={e => {
              if (e.target.value === CUSTOM_VALUE) {
                setCustomMode(true);
                return;
              }
              onChange({ ...value, storageClass: e.target.value || undefined });
            }}
          >
            <MenuItem value="">Cluster default</MenuItem>
            {(storageClasses ?? []).map(sc => (
              <MenuItem key={sc.getName()} value={sc.getName()}>
                {sc.getName()}
              </MenuItem>
            ))}
            <MenuItem value={CUSTOM_VALUE}>Custom name…</MenuItem>
          </Select>
        </FormControl>
      )}
    </>
  );
}
