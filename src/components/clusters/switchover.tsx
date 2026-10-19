import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
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
import { Pod } from '../common/podActions';

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Manual switchover works by setting Cluster.status.targetPrimary to the replica's name — the
// operator then does the actual promotion/demotion. This is the same mechanism CNPG's own
// `kubectl cnpg promote` uses (it patches via the status subresource, not spec), which is why this
// goes through the /status endpoint rather than KubeObject.patch() (that hits the main resource
// endpoint, where a status-subresource CRD like Cluster silently ignores .status changes).
async function setTargetPrimary(cluster: Cluster, targetPrimary: string) {
  return ApiProxy.patch(
    `/apis/postgresql.cnpg.io/v1/namespaces/${cluster.getNamespace()}/clusters/${cluster.getName()}/status`,
    { status: { targetPrimary } },
    false,
    { cluster: cluster.cluster }
  );
}

export function SwitchoverAction({
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
  // ActionButton doesn't accept a bare `disabled` prop (only `iconButtonProps.disabled`), so
  // this can't reuse AuthDisabledButton (built around plain MUI Buttons) — the permission check
  // is wired in directly instead, following the same allowed-until-checked default.
  const [allowed, setAllowed] = useState(true);
  const replicaName = pod.getName();
  const description = 'Switchover to this instance';
  const icon = 'mdi:crown-outline';
  const deniedMessage = "You don't have permission to switch over this cluster's primary.";

  const button =
    buttonStyle === 'menu' ? (
      // Menu-style ActionButtons ignore `disabled`, so the denied state renders its own
      // disabled MenuItem instead of being hidden — a read-only user still sees the action.
      allowed ? (
        <ActionButton
          description={description}
          icon={icon}
          buttonStyle="menu"
          onClick={() => setOpen(true)}
        />
      ) : (
        <Tooltip title={deniedMessage}>
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
        iconButtonProps={{ disabled: !allowed }}
      />
    );

  return (
    <>
      <AuthVisible
        item={cluster}
        authVerb="patch"
        subresource="status"
        onAuthResult={({ allowed: result }) => setAllowed(result)}
      >
        {null}
      </AuthVisible>
      {buttonStyle === 'action' && !allowed ? (
        <Tooltip title="You don't have permission to switch over this cluster's primary.">
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <ConfirmDialog
        open={open}
        handleClose={() => setOpen(false)}
        title="Switchover primary"
        description={
          <>
            This promotes <strong>{replicaName}</strong> to primary and demotes the current primary
            to a replica.{' '}
            <strong>
              Applications will briefly lose connectivity to the database while the switchover
              completes
            </strong>
            . Do you want to continue?
          </>
        }
        onConfirm={() => {
          setOpen(false);
          afterConfirm?.();
          setTargetPrimary(cluster, replicaName)
            .then(() => {
              enqueueSnackbar(`Switchover to ${replicaName} started`, { variant: 'success' });
            })
            .catch(error => {
              enqueueSnackbar(
                `Failed to start switchover to ${replicaName}: ${formatError(error)}`,
                { variant: 'error' }
              );
            });
        }}
      />
    </>
  );
}
