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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Hibernation is a metadata-annotation change on the Cluster itself (not the status
// subresource like switchover), so this patches the main resource endpoint via
// Cluster.setHibernated — the same `cnpg.io/hibernation=on|off` annotation the
// `kubectl cnpg hibernate` command manages.
function HibernateToggleButton({
  cluster,
  buttonStyle = 'action',
  afterConfirm,
}: {
  cluster: Cluster;
  /** 'menu' when rendered inside the table's row-action menu, 'action' (icon) elsewhere. */
  buttonStyle?: 'action' | 'menu';
  /**
   * Closes the row-action menu after the dialog is confirmed (list usage only). This must NOT
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

  const hibernated = cluster.isHibernated;
  const name = cluster.getName();
  const description = hibernated ? 'Rehydrate' : 'Hibernate';
  const icon = hibernated ? 'mdi:sleep-off' : 'mdi:sleep';
  const deniedMessage = hibernated
    ? "You don't have permission to rehydrate this cluster."
    : "You don't have permission to hibernate this cluster.";

  const handleOpen = () => {
    setOpen(true);
  };

  return (
    <>
      <AuthVisible
        item={cluster}
        authVerb="patch"
        onAuthResult={({ allowed: result }) => setAllowed(result)}
      >
        {null}
      </AuthVisible>
      {buttonStyle === 'menu' ? (
        // Menu-style ActionButtons ignore `disabled`, so the denied state renders its own
        // disabled MenuItem instead of being hidden — a read-only user still sees the action.
        allowed ? (
          <ActionButton
            description={description}
            icon={icon}
            buttonStyle="menu"
            onClick={handleOpen}
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
      ) : allowed ? (
        <ActionButton
          description={description}
          icon={icon}
          onClick={handleOpen}
          iconButtonProps={{ disabled: !allowed }}
        />
      ) : (
        <Tooltip title={deniedMessage}>
          <span>
            <ActionButton
              description={description}
              icon={icon}
              onClick={handleOpen}
              iconButtonProps={{ disabled: true }}
            />
          </span>
        </Tooltip>
      )}
      <ConfirmDialog
        open={open}
        handleClose={() => setOpen(false)}
        title={hibernated ? 'Rehydrate cluster' : 'Hibernate cluster'}
        description={
          hibernated ? (
            <>
              This removes hibernation from <strong>{name}</strong> and recreates its instance pods
              from the retained storage. Do you want to continue?
            </>
          ) : (
            <>
              <p>
              This hibernates <strong>{name}</strong>: all instance pods are deleted (saving CPU and
              memory) while storage is kept, and the cluster can be rehydrated at any time.
              </p>
              <p>
                <strong>
                  Applications will lose connectivity to the database until it is rehydrated.
                </strong>
              </p>
              <p>
                Do you want to continue?
              </p>
            </>
          )
        }
        onConfirm={() => {
          setOpen(false);
          afterConfirm?.();
          cluster
            .setHibernated(!hibernated)
            .then(() => {
              enqueueSnackbar(
                hibernated ? `Cluster ${name} is rehydrating` : `Cluster ${name} is hibernating`,
                { variant: 'success' }
              );
            })
            .catch(error => {
              enqueueSnackbar(
                `Failed to ${hibernated ? 'rehydrate' : 'hibernate'} cluster ${name}: ${formatError(
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

/**
 * Per-row hibernate/rehydrate toggle for the cluster list's action menu (right side of the
 * table). Renders the hibernate action when the cluster is running and the rehydrate action
 * when it is hibernated.
 */
export function HibernateListAction({
  cluster,
  closeMenu,
}: {
  cluster: Cluster;
  closeMenu?: () => void;
}) {
  return <HibernateToggleButton cluster={cluster} buttonStyle="menu" afterConfirm={closeMenu} />;
}

/** Header hibernate action for the (non-hibernated) cluster detail page. */
export function HibernateDetailAction({ cluster }: { cluster: Cluster }) {
  // Rehydration lives on the cluster list only: a hibernated cluster's detail page isn't
  // reachable (it has no status to display), so offering "rehydrate" here would strand users
  // on an unreachable page.
  if (cluster.isHibernated) {
    return null;
  }
  return <HibernateToggleButton cluster={cluster} />;
}
