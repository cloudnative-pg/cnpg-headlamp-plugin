import { Icon } from '@iconify/react';
import { ActionButton, AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Cluster } from '../../resources/cluster';
import { getClusterCloneUrl } from './create/CreatePage';

// ActionButton doesn't accept a bare `disabled` prop (only `iconButtonProps.disabled`), so this
// can't reuse AuthDisabledButton — the permission check is wired in directly instead, following
// the same allowed-until-checked default as switchover.tsx.
export function ForkClusterAction({
  cluster,
  buttonStyle = 'action',
  closeMenu,
}: {
  cluster: Cluster;
  /** 'menu' when rendered inside the list's row-action menu, 'action' (icon) on the detail page. */
  buttonStyle?: 'action' | 'menu';
  /** Closes the row-action menu after navigating (menu usage only). */
  closeMenu?: () => void;
}) {
  const history = useHistory();
  const [allowed, setAllowed] = useState(true);
  const description = 'Fork cluster';
  const icon = 'mdi:source-fork';
  const deniedMessage = "You don't have permission to create Clusters in this namespace.";

  function handleClick() {
    closeMenu?.();
    history.push(
      getClusterCloneUrl({ namespace: cluster.getNamespace(), sourceName: cluster.getName() })
    );
  }

  const button =
    buttonStyle === 'menu' ? (
      // Menu-style ActionButtons ignore `disabled`, so the denied state renders its own
      // disabled MenuItem instead of being hidden — a read-only user still sees the action.
      allowed ? (
        <ActionButton
          description={description}
          icon={icon}
          buttonStyle="menu"
          onClick={handleClick}
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
        onClick={handleClick}
        iconButtonProps={{ disabled: !allowed }}
      />
    );

  return (
    <>
      <AuthVisible
        item={Cluster}
        authVerb="create"
        namespace={cluster.getNamespace()}
        onAuthResult={({ allowed: result }) => setAllowed(result)}
      >
        {null}
      </AuthVisible>
      {buttonStyle === 'action' && !allowed ? (
        <Tooltip title={deniedMessage}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
    </>
  );
}
