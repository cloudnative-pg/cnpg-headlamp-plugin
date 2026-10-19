import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { ActionButton, SectionBox, Terminal } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import { useHistory, useParams } from 'react-router-dom';
import { Pod } from './podActions';

const { createRouteURL } = Router;

export function getPodTerminalUrl(pod: Pod): string {
  return createRouteURL('CNPG Pod Terminal', {
    namespace: pod.metadata.namespace,
    name: pod.metadata.name,
    cluster: pod.cluster,
  });
}

// A plain button (rather than a bare onClick prop, like the rest of podActions.tsx) because
// navigating needs useHistory(), and a hook can't be called from an onClick callback — this
// wraps that up so call sites don't each need their own useHistory().
export function OpenTerminalButton({ pod }: { pod: Pod }) {
  const history = useHistory();
  return (
    <ActionButton
      description="Open terminal"
      icon="mdi:console"
      onClick={() => history.push(getPodTerminalUrl(pod))}
    />
  );
}

// Registered at /cnpg/pods/:namespace/:name/terminal (see registerRoute in index.tsx). A
// standalone page rather than the Activity overlay this used to be, for the same reason as
// PodLogsPage (see its comment): Headlamp 0.45's Activities framework doesn't give Terminal's
// internal viewport-relative sizing ('.xterm { height: 100vh }') anything sane to resolve
// against, leaving its container-select toolbar scrolled out of view above the fold.
export function PodTerminalPage() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [pod] = K8s.ResourceClasses.Pod.useGet(name, namespace);

  return (
    // See PodLogsPage for why 'calc(100vh - 70px)' and the flex column/alignItems setup.
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 70px)' }}>
      <Box sx={{ alignSelf: 'flex-start' }}>
        <SectionBox title={pod ? `Terminal: ${pod.metadata.name}` : 'Terminal'} backLink />
      </Box>
      {pod && (
        // Same treatment as PodLogViewer's wrapper in podLogs.tsx: 'flex: 1' + 'minHeight: 0'
        // gives Terminal's internal DialogContent (already 'height: 100%' in the SDK, unlike
        // LogViewer's 80%) a definite ancestor height to resolve against, the nested selector
        // overrides the hardcoded '.xterm { height: 100vh }', and the negative horizontal margin
        // cancels DialogContent's own default 24px padding stacking on top of SectionBox's.
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            mx: -3,
            '& .MuiDialogContent-root': { height: '100%', minHeight: 0 },
            '& .xterm': { height: '100%' },
          }}
        >
          <Terminal noDialog open item={pod} onClose={() => {}} isAttach={false} />
        </Box>
      )}
    </Box>
  );
}
