import { Icon } from '@iconify/react';
import {
  ActionButton,
  AuthVisible,
  ConfirmDialog,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { Cluster } from '../../resources/cluster';
import { FENCE_ALL_INSTANCES } from '../../resources/fencing';
import { Pod } from '../common/podActions';

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Fencing is a metadata-annotation change on the Cluster (like hibernation), so this patches the
// main resource endpoint via Cluster.setInstanceFenced — the same `cnpg.io/fencedInstances`
// annotation `kubectl cnpg fencing on|off` manages. The operator then shuts the instance's
// postmaster down (or starts it again) asynchronously, after up to `.spec.switchoverDelay`.
export function FenceAction({
  cluster,
  pod,
  buttonStyle = 'action',
  afterConfirm,
}: {
  cluster: Cluster;
  pod: Pod;
  /** 'menu' when rendered inside a row-action menu, 'action' (icon) elsewhere. */
  buttonStyle?: 'action' | 'menu';
  /**
   * Closes the row-action menu after the dialog is confirmed (menu usage only). This must NOT
   * run when opening the dialog: the toggle lives inside the menu, so closing it first would
   * unmount this component and instantly kill the dialog's `open` state. DeleteButton follows
   * this same open-first-close-after pattern via its own `afterConfirm`.
   */
  afterConfirm?: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  // Same allowed-until-checked pattern as switchover.tsx: ActionButton has no bare `disabled`
  // prop (only `iconButtonProps.disabled`), so the RBAC check is wired in directly.
  const [allowed, setAllowed] = useState(true);

  const instanceName = pod.getName();
  const fenced = cluster.isInstanceFenced(instanceName);
  const isPrimary = instanceName === cluster.currentPrimary;
  const fencedInstances = cluster.fencedInstances;

  // The operator refuses to unfence a single instance while the whole cluster is fenced, and
  // rejects an annotation it can't parse, so the action is disabled in both cases.
  let blockedMessage: string | undefined;
  if (fencedInstances === undefined) {
    blockedMessage = 'The cnpg.io/fencedInstances annotation has invalid syntax.';
  } else if (fenced && fencedInstances.includes(FENCE_ALL_INSTANCES)) {
    blockedMessage =
      'All instances are fenced: use kubectl cnpg fencing to unfence the whole cluster.';
  }

  const description = fenced ? 'Unfence instance' : 'Fence instance';
  const icon = fenced ? 'mdi:gate-open' : 'mdi:gate';
  const disabledMessage = !allowed
    ? `You don't have permission to ${fenced ? 'unfence' : 'fence'} this instance.`
    : blockedMessage;

  const button =
    buttonStyle === 'menu' ? (
      // Menu-style ActionButtons ignore `disabled`, so the denied/blocked state renders its
      // own disabled MenuItem instead of being hidden — the user still sees the action.
      disabledMessage === undefined ? (
        <ActionButton
          description={description}
          icon={icon}
          buttonStyle="menu"
          onClick={() => setOpen(true)}
        />
      ) : (
        <Tooltip title={disabledMessage}>
          <span>
            <MenuItem disabled>
              <ListItemIcon>
                <Icon icon={icon} width={20} />
              </ListItemIcon>
              <ListItemText>{description}</ListItemText>
            </MenuItem>
          </span>
        </Tooltip>
      )
    ) : (
      <ActionButton
        description={description}
        icon={icon}
        onClick={() => setOpen(true)}
        iconButtonProps={{ disabled: disabledMessage !== undefined }}
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
      {buttonStyle === 'action' && disabledMessage !== undefined ? (
        <Tooltip title={disabledMessage}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <ConfirmDialog
        open={open}
        handleClose={() => setOpen(false)}
        title={fenced ? 'Unfence instance' : 'Fence instance'}
        description={
          fenced ? (
            <>
              This lifts fencing from <strong>{instanceName}</strong> and starts its PostgreSQL
              server again. Do you want to continue?
            </>
          ) : (
            <>
              <p>
                This fences <strong>{instanceName}</strong>: its PostgreSQL server is shut down
                while the pod is kept running, so its data can be inspected without being modified.
                The pod stops being Ready once the shutdown completes, which can take up to the
                cluster&apos;s switchover delay.
              </p>
              {isPrimary && (
                <p>
                  <strong>
                    This instance is the primary: no failover is performed, so applications
                    connected to the primary will lose access to the database until the fence is
                    lifted.
                  </strong>
                </p>
              )}
              <p>Do you want to continue?</p>
            </>
          )
        }
        onConfirm={() => {
          setOpen(false);
          afterConfirm?.();
          cluster
            .setInstanceFenced(instanceName, !fenced)
            .then(() => {
              enqueueSnackbar(
                fenced
                  ? `Instance ${instanceName} is being unfenced`
                  : `Instance ${instanceName} is being fenced`,
                { variant: 'success' }
              );
            })
            .catch(error => {
              enqueueSnackbar(
                `Failed to ${fenced ? 'unfence' : 'fence'} instance ${instanceName}: ${formatError(
                  error
                )}`,
                { variant: 'error' }
              );
            });
        }}
      />
    </>
  );
}
