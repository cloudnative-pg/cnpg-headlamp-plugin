import { K8s, Utils } from '@kinvolk/headlamp-plugin/lib';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { SxProps, Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { RequiredLabel } from './RequiredLabel';

interface NamespaceFieldProps {
  /** Used to build unique ids for the label/select (e.g. "create-cluster" -> "create-cluster-namespace-label"). */
  idPrefix: string;
  value: string;
  onChange: (namespace: string) => void;
  required?: boolean;
  sx?: SxProps<Theme>;
}

// Namespace picker shared by every Create form. Listing Namespaces cluster-wide needs its own
// RBAC, which namespace-scoped users (e.g. bound only via a Role in one namespace) don't have —
// the list call below fails for them and would otherwise leave the dropdown with no options at
// all. Prefer the Headlamp cluster's configured Allowed Namespaces (the same source
// AuthDisabledButton's allowedNamespacesHint uses) over the list API result — it's what the
// admin already scoped this cluster to, and it works regardless of whether the list call above
// succeeds. Fall back to the list API result when Allowed Namespaces isn't configured, and
// finally to free text when neither source has anything to offer.
export function NamespaceField({
  idPrefix,
  value,
  onChange,
  required = true,
  sx,
}: NamespaceFieldProps) {
  const [namespaces, namespacesError] = K8s.ResourceClasses.Namespace.useList();
  const allowedNamespaces = K8s.cluster.getAllowedNamespaces(Utils.getCluster());
  const namespaceListDenied = allowedNamespaces.length === 0 && !!namespacesError && !namespaces;
  const options =
    allowedNamespaces.length > 0
      ? allowedNamespaces
      : namespaces && namespaces.length > 0
      ? namespaces.map(ns => ns.getName())
      : [];
  const labelId = `${idPrefix}-namespace-label`;

  if (options.length > 0) {
    return (
      <FormControl fullWidth margin="normal" sx={sx}>
        <InputLabel id={labelId}>
          <RequiredLabel label="Namespace" required={required} />
        </InputLabel>
        <Select
          labelId={labelId}
          label={<RequiredLabel label="Namespace" required={required} />}
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          {options.map(name => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </Select>
        {allowedNamespaces.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Showing this cluster's Allowed Namespaces setting.
          </Typography>
        )}
      </FormControl>
    );
  }

  return (
    <TextField
      fullWidth
      margin="normal"
      label={<RequiredLabel label="Namespace" required={required} />}
      value={value}
      onChange={e => onChange(e.target.value)}
      helperText={
        namespaceListDenied
          ? "You don't have permission to list Namespaces and this cluster has no Allowed Namespaces configured — enter the namespace name directly."
          : undefined
      }
      sx={sx}
    />
  );
}
