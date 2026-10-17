import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { ActionButton, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { alpha, Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { parseCnpgLogLines, ParsedLogLine } from '../../resources/cnpgLog';
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

type ChipColor = 'error' | 'warning' | 'info' | 'default';

function severityColor(severity: string): ChipColor {
  switch (severity) {
    case 'PANIC':
    case 'FATAL':
    case 'ERROR':
      return 'error';
    case 'WARNING':
    case 'WARN':
      return 'warning';
    case 'INFO':
    case 'LOG':
    case 'NOTICE':
      return 'info';
    default:
      return 'default';
  }
}

// Light background tint for a log row, based on its severity; neutral rows stay untinted.
function rowTint(theme: Theme, severity: string, opacity: number): string | undefined {
  const color = severityColor(severity);
  return color === 'default' ? undefined : alpha(theme.palette[color].main, opacity);
}

// Severity is shown as a small colored dot plus a plain label (not a heavy badge), so thousands
// of lines stay scannable.
function SeverityBadge({ severity }: { severity: string }) {
  const color = severityColor(severity);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box
        component="span"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: color === 'default' ? 'text.disabled' : `${color}.main`,
        }}
      />
      <span>{severity || '-'}</span>
    </Box>
  );
}

// zap's `ts` is either an ISO string or epoch seconds (float), depending on the CNPG version.
function parseTimestamp(ts: unknown): Date | undefined {
  if (ts === undefined || ts === null || ts === '') {
    return undefined;
  }
  const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(String(ts));
  return isNaN(date.getTime()) ? undefined : date;
}

function formatTime(ts: unknown): string {
  const date = parseTimestamp(ts);
  return date ? date.toLocaleTimeString([], { hour12: false }) : String(ts ?? '');
}

function formatFullTimestamp(ts: unknown): string {
  const date = parseTimestamp(ts);
  return date ? date.toISOString() : String(ts ?? '');
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// Postgres record fields worth their own section when present, in display order.
const POSTGRES_CONTEXT_KEYS = ['query', 'detail', 'hint', 'context', 'internal_query'];

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, py: 0.25 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 130, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
        {value}
      </Typography>
    </Box>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Divider sx={{ mb: 0.5 }} />
      {children}
    </Box>
  );
}

const codeSx = {
  m: 0,
  p: 1,
  fontFamily: 'monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  bgcolor: 'action.hover',
  borderRadius: 1,
} as const;

function LogDetails({
  entry,
  container,
  pod,
}: {
  entry: ParsedLogLine;
  container: string;
  pod: string;
}) {
  const [showJson, setShowJson] = useState(false);
  const context = POSTGRES_CONTEXT_KEYS.filter(key => entry.extra[key] !== undefined);
  const additional = Object.entries(entry.extra).filter(([key]) => !context.includes(key));
  const json = useMemo(() => prettyJson(entry.raw), [entry.raw]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SeverityBadge severity={entry.severity} />
        <Typography variant="subtitle1" fontWeight={600}>
          {entry.logger ?? '-'}
        </Typography>
      </Box>
      <Typography variant="body1" sx={{ mt: 1, wordBreak: 'break-word' }}>
        {entry.message}
      </Typography>

      <DetailSection title="Event">
        <FieldRow label="Severity" value={entry.severity || '-'} />
        <FieldRow label="Timestamp" value={formatFullTimestamp(entry.ts) || '-'} />
        <FieldRow label="Logger" value={entry.logger ?? '-'} />
        <FieldRow label="Container" value={container} />
        <FieldRow label="Pod" value={pod} />
      </DetailSection>

      {context.length > 0 && (
        <DetailSection title="PostgreSQL context">
          {context.map(key => (
            <Box key={key} sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {key}
              </Typography>
              <Box component="pre" sx={codeSx}>
                {formatValue(entry.extra[key])}
              </Box>
            </Box>
          ))}
        </DetailSection>
      )}

      {additional.length > 0 && (
        <DetailSection title="Additional fields">
          {additional.map(([key, value]) => (
            <FieldRow key={key} label={key} value={formatValue(value)} />
          ))}
        </DetailSection>
      )}

      <DetailSection title="Raw JSON">
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <Button size="small" onClick={() => navigator.clipboard?.writeText(json)}>
            Copy JSON
          </Button>
          <Button size="small" onClick={() => setShowJson(v => !v)}>
            {showJson ? 'Collapse' : 'Expand'}
          </Button>
        </Box>
        {showJson && (
          <Box component="pre" sx={codeSx}>
            {json}
          </Box>
        )}
      </DetailSection>
    </Box>
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
  const [container, setContainer] = useState(
    // Default to the pod's first regular container (postgres), not the first init container.
    pod.spec.containers[0]?.name ?? containerNames[0]
  );
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!live) {
      return;
    }
    // getLogs mutates and reuses the same array reference on every streamed chunk, so we copy it
    // — otherwise React's setState bails out after the first update (same reference => no re-render).
    const cancel = pod.getLogs(container, ({ logs: lines }) => setRawLogs([...lines]), {
      tailLines: 200,
      follow: true,
    });
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pod.metadata.uid, container, live]);

  const parsedLogs = useMemo(() => parseCnpgLogLines(rawLogs), [rawLogs]);

  const severities = useMemo(
    () => Array.from(new Set(parsedLogs.map(entry => entry.severity).filter(Boolean))).sort(),
    [parsedLogs]
  );
  const loggers = useMemo(
    () => Array.from(new Set(parsedLogs.map(entry => entry.logger).filter(Boolean))).sort(),
    [parsedLogs]
  );

  // Keep each entry's index in parsedLogs so the selection survives filter changes.
  const displayLogs = useMemo(() => {
    const needle = search.toLowerCase();
    return parsedLogs
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !severityFilter || entry.severity === severityFilter)
      .filter(({ entry }) => !loggerFilter || entry.logger === loggerFilter)
      .filter(
        ({ entry }) =>
          !needle ||
          entry.message.toLowerCase().includes(needle) ||
          JSON.stringify(entry.extra).toLowerCase().includes(needle)
      );
  }, [parsedLogs, severityFilter, loggerFilter, search]);

  useEffect(() => {
    // Follow the tail while live, except while a row is selected — otherwise it would scroll
    // away mid-inspection. Closing the details panel resumes following.
    if (live && selected === null && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [displayLogs, live, selected]);

  const selectedEntry = selected !== null ? parsedLogs[selected] : undefined;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        {containerNames.length > 1 && (
          <Select
            size="small"
            value={container}
            onChange={e => {
              setContainer(e.target.value);
              setSeverityFilter('');
              setLoggerFilter('');
              setSelected(null);
              setRawLogs([]);
            }}
          >
            {containerNames.map(name => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
        )}
        <Select
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
        </Select>
        <Select
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
        </Select>
        <TextField
          size="small"
          placeholder="Search messages and fields…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant={live ? 'contained' : 'outlined'}
          onClick={() => setLive(v => !v)}
        >
          {live ? 'Live ●' : 'Paused'}
        </Button>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 2 }}>
        <Box
          ref={listRef}
          sx={{
            flex: selectedEntry ? '1 1 55%' : 1,
            minWidth: 0,
            overflow: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '80px 84px 160px 1fr',
              gap: 1,
              px: 1,
              py: 0.5,
              position: 'sticky',
              top: 0,
              zIndex: 1,
              bgcolor: 'background.paper',
              borderBottom: 1,
              borderColor: 'divider',
              fontWeight: 600,
            }}
          >
            <span>Time</span>
            <span>Severity</span>
            <span>Logger</span>
            <span>Message</span>
          </Box>
          {displayLogs.map(({ entry, index }) => (
            <Box
              key={index}
              onClick={() => {
                setSelected(index);
              }}
              sx={{
                display: 'grid',
                gridTemplateColumns: '80px 84px 160px 1fr',
                gap: 1,
                px: 1,
                py: 0.25,
                alignItems: 'center',
                cursor: 'pointer',
                bgcolor: theme => rowTint(theme, entry.severity, 0.08),
                '&:hover': { bgcolor: theme => rowTint(theme, entry.severity, 0.18) },
                // Selected rows get a stronger tint plus a left accent bar.
                ...(index === selected && {
                  bgcolor: theme => rowTint(theme, entry.severity, 0.25),
                  boxShadow: theme => `inset 3px 0 0 ${theme.palette.primary.main}`,
                }),
              }}
            >
              <span>{formatTime(entry.ts)}</span>
              <SeverityBadge severity={entry.severity} />
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.logger ?? '-'}
              </Box>
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.message}
              </Box>
            </Box>
          ))}
        </Box>

        {selectedEntry && (
          <Box
            sx={{
              flex: '1 1 45%',
              minWidth: 0,
              overflow: 'auto',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              p: 2,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="overline" color="text.secondary">
                Selected event
              </Typography>
              <Button size="small" onClick={() => setSelected(null)}>
                Close
              </Button>
            </Box>
            <LogDetails entry={selectedEntry} container={container} pod={pod.metadata.name} />
          </Box>
        )}
      </Box>
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
