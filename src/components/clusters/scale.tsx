import { ActionButton, AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { Cluster } from '../../resources/cluster';

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Scaling is a change to spec.instances on the Cluster itself (the main resource endpoint, unlike
// switchover's status subresource), so it patches via Cluster.setInstances.
export function ScaleAction({ cluster }: { cluster: Cluster }) {
  const { enqueueSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  // Same allowed-until-checked pattern as switchover.tsx: ActionButton has no bare `disabled`
  // prop (only `iconButtonProps.disabled`), so the RBAC check is wired in directly.
  const [allowed, setAllowed] = useState(true);

  const name = cluster.getName();
  const current = cluster.instances;
  const target = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(target) && target >= 1;
  const unchanged = valid && target === current;
  const switchingOver = cluster.isSwitchoverInProgress;
  const description = 'Scale';
  const icon = 'mdi:arrow-expand-vertical';
  const disabledMessage = !allowed
    ? "You don't have permission to scale this cluster."
    : switchingOver
    ? 'The cluster cannot be scaled while a switchover is in progress.'
    : '';

  const handleOpen = () => {
    setValue(String(current));
    setOpen(true);
  };

  const handleConfirm = () => {
    setOpen(false);
    cluster
      .setInstances(target)
      .then(() => {
        enqueueSnackbar(`Scaling cluster ${name} to ${target} instance${target === 1 ? '' : 's'}`, {
          variant: 'success',
        });
      })
      .catch(error => {
        enqueueSnackbar(`Failed to scale cluster ${name}: ${formatError(error)}`, {
          variant: 'error',
        });
      });
  };

  const button = (
    <ActionButton
      description={description}
      icon={icon}
      onClick={handleOpen}
      iconButtonProps={{ disabled: !!disabledMessage }}
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
      {disabledMessage ? (
        <Tooltip title={disabledMessage}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Scale cluster</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            <strong>{name}</strong> currently runs {current} instance{current === 1 ? '' : 's'}. Set
            the desired total number of instances (primary included).
          </DialogContentText>
          <TextField
            fullWidth
            type="number"
            label="Instances"
            value={value}
            onChange={e => setValue(e.target.value)}
            inputProps={{ min: 1, step: 1 }}
            error={value !== '' && !valid}
            helperText={
              value !== '' && !valid
                ? 'Enter a whole number of at least 1.'
                : valid && target < 2
                ? 'A single instance has no high availability: if it fails, the database is unavailable until it recovers.'
                : valid && target < current
                ? 'Replicas will be removed; the operator may pick which ones.'
                : ' '
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirm} variant="contained" disabled={!valid || unchanged}>
            Scale
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
