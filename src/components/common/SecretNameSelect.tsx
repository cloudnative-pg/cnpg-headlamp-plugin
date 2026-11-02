import { K8s } from '@kinvolk/headlamp-plugin/lib';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { RequiredLabel } from './RequiredLabel';

// Picks an existing Secret name (scoped to `namespace`) — for spec fields that reference a
// whole Secret (tlsSecretName, caSecretName, clientSecretName, ...) rather than a key within
// one. Only references pre-existing Secrets; it does not create one.
export function SecretNameSelect({
  namespace,
  label,
  value,
  onChange,
  idPrefix,
  required,
}: {
  namespace: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
  required?: boolean;
}) {
  const [secrets] = K8s.ResourceClasses.Secret.useList({ namespace });

  return (
    <FormControl fullWidth margin="normal">
      <InputLabel id={`${idPrefix}-label`}>
        <RequiredLabel label={label} required={required} />
      </InputLabel>
      <Select
        labelId={`${idPrefix}-label`}
        label={<RequiredLabel label={label} required={required} />}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {(secrets ?? []).map(secret => (
          <MenuItem key={secret.getName()} value={secret.getName()}>
            {secret.getName()}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
