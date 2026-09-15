import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  LogViewer,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { useEffect, useMemo, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { formatCnpgLogLine, parseCnpgLogLines } from '../../resources/cnpgLog';
import { Pod } from './podActions';

const { createRouteURL } = Router;

export function getPodLogsUrl(pod: Pod): string {
  return createRouteURL('CNPG Pod Logs', {
    namespace: pod.metadata.namespace,
    name: pod.metadata.name,
    cluster: pod.cluster,
  });
}

// A plain button (rather than a bare onClick prop, like the rest of podActions.tsx) because
// navigating needs useHistory(), and a hook can't be called from an onClick callback — this
// wraps that up so call sites don't each need their own useHistory().
export function ViewLogsButton({ pod }: { pod: Pod }) {
  const history = useHistory();
  return (
    <ActionButton
      description="View logs"
      icon="mdi:file-document-box-outline"
      onClick={() => history.push(getPodLogsUrl(pod))}
    />
  );
}

function PodLogViewer({ pod }: { pod: Pod }) {
  // Native sidecars (e.g. the Barman Cloud plugin's instance sidecar) are init containers with
  // restartPolicy: Always — they run for the pod's whole life like a regular container, but live
  // in spec.initContainers rather than spec.containers.
  const containerNames = [
    ...(pod.spec.initContainers ?? []).map(c => c.name),
    ...pod.spec.containers.map(c => c.name),
  ];
  const [rawLogs, setRawLogs] = useState<string[]>([]);
  const [severityFilter, setSeverityFilter] = useState('');
  const [loggerFilter, setLoggerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [container, setContainer] = useState(containerNames[0]);

  useEffect(() => {
    // getLogs mutates and reuses the same array reference on every streamed chunk, so we copy it
    // — otherwise React's setState bails out after the first update (same reference => no re-render).
    const cancel = pod.getLogs(container, ({ logs: lines }) => setRawLogs([...lines]), {
      tailLines: 200,
      follow: true,
    });
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pod.metadata.uid, container]);

  const parsedLogs = useMemo(() => parseCnpgLogLines(rawLogs), [rawLogs]);

  const severities = useMemo(
    () => Array.from(new Set(parsedLogs.map(entry => entry.severity).filter(Boolean))).sort(),
    [parsedLogs]
  );
  const loggers = useMemo(
    () => Array.from(new Set(parsedLogs.map(entry => entry.logger).filter(Boolean))).sort(),
    [parsedLogs]
  );

  const displayLogs = useMemo(
    () =>
      parsedLogs
        .filter(entry => !severityFilter || entry.severity === severityFilter)
        .filter(entry => !loggerFilter || entry.logger === loggerFilter)
        .filter(entry => !search || entry.message.toLowerCase().includes(search.toLowerCase()))
        .map(formatCnpgLogLine),
    [parsedLogs, severityFilter, loggerFilter, search]
  );

  return (
    // LogViewer's noDialog mode was built assuming a near-viewport-height MUI Dialog host: its
    // internal DialogContent hardcodes 'height: 80%, minHeight: 80%' (fine when 80% of a Dialog
    // paper still reads as "full"), and its xterm terminal is separately hardcoded to
    // 'height: 100vh'. 'flex: 1' + 'minHeight: 0' makes this Box fill exactly whatever space
    // PodLogsPage's flex column leaves for it (giving descendants a definite height to resolve
    // percentages against, per the flexbox spec) — the nested selectors below then override the
    // SDK's own 80%/100vh with 100%, since we can't pass sx into LogViewer's internals directly.
    // Both overrides out-specificity the SDK's rules (2 classes: this Box's generated class +
    // the target's own static Mui class, vs the SDK's single class on the target itself), no
    // '!important' needed. The negative horizontal margin cancels out DialogContent's own default
    // 24px padding — LogViewer renders through a DialogContent even in noDialog mode, which
    // assumes it's the only padding source (normally true inside a bare Dialog); here it stacks on
    // top of SectionBox's own padding, so without this it's visibly wider-margined than other pages.
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        mx: -3,
        '& .MuiDialogContent-root': { height: '100%', minHeight: 0 },
        '& .xterm': { height: '100%' },
      }}
    >
      <LogViewer
        noDialog
        open
        logs={displayLogs}
        title={pod.metadata.name}
        downloadName={`${pod.metadata.name}_${container}`}
        onClose={() => {}}
        topActions={[
          ...(containerNames.length > 1
            ? [
                <Select
                  key="container"
                  size="small"
                  value={container}
                  onChange={e => {
                    setContainer(e.target.value);
                    setSeverityFilter('');
                    setLoggerFilter('');
                  }}
                >
                  {containerNames.map(name => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>,
              ]
            : []),
          <TextField
            key="search"
            size="small"
            placeholder="Search message…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />,
          <Select
            key="severity"
            size="small"
            displayEmpty
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
          >
            <MenuItem value="">All levels</MenuItem>
            {severities.map(severity => (
              <MenuItem key={severity} value={severity}>
                {severity}
              </MenuItem>
            ))}
          </Select>,
          <Select
            key="logger"
            size="small"
            displayEmpty
            value={loggerFilter}
            onChange={e => setLoggerFilter(e.target.value)}
          >
            <MenuItem value="">All loggers</MenuItem>
            {loggers.map(logger => (
              <MenuItem key={logger} value={logger}>
                {logger}
              </MenuItem>
            ))}
          </Select>,
        ]}
      />
    </Box>
  );
}

// Registered at /cnpg/pods/:namespace/:name/logs (see registerRoute in index.tsx). A standalone
// page rather than the Activity overlay this used to be: Headlamp 0.45's Activities framework
// hosts activity content in a shorter-than-viewport, non-definite-height flex container, which
// doesn't give LogViewer's internal viewport-relative sizing anything sane to resolve against and
// left the toolbar scrolled out of view above the fold. A normal routed page doesn't have that
// problem — it does not need to fit inside a fixed-height overlay grid cell.
export function PodLogsPage() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [pod] = K8s.ResourceClasses.Pod.useGet(name, namespace);

  return (
    // 'calc(100vh - 70px)' matches Headlamp's own convention for a full-height page (see
    // AdvancedSearch.js in the SDK, which uses the same 70px — the app bar's height). Laid out as
    // a flex column so the log viewer (flex: 1) fills whatever's left below the title/back-link.
    // Keeps the default alignItems: 'stretch' so the log viewer (and its xterm content) still
    // spans the full page width, like every other page — only the header opts out of that via its
    // own wrapper below, rather than flipping the default for every child.
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 70px)' }}>
      {/* MUI's Button (rendered by SectionBox's backLink) centers its own label — stretched to
          the page's full width by the column's default alignItems, "Back" ended up floating
          mid-screen instead of hugging the left edge. alignSelf: 'flex-start' here keeps just
          this wrapper (and so the button) at its natural content width. */}
      <Box sx={{ alignSelf: 'flex-start' }}>
        <SectionBox title={pod ? `Logs: ${pod.metadata.name}` : 'Logs'} backLink />
      </Box>
      {pod && <PodLogViewer pod={pod} />}
    </Box>
  );
}
