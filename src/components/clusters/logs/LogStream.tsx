import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Pagination from '@mui/material/Pagination';
import Select from '@mui/material/Select';
import { alpha } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { prettyJson } from '../../../resources/cnpgLog';
import {
  LOG_CATEGORIES,
  LOG_CATEGORY_LABELS,
  LogCategory,
  PostgresLogEntry,
  severityGroup,
} from '../../../resources/postgresLog';
import { codeSx, DetailSection } from '../../common/podLogs';
import { InstanceChip } from './InstanceChip';
import { formatCount, formatLogTimestamp, LogColors, roleColor, useLogColors } from './logTheme';

const PAGE_SIZES = [10, 25, 50, 100];

// Shared by the header and every row so the columns can't drift apart.
const STREAM_COLUMNS = '168px 176px 124px 84px minmax(200px, 1fr)';

const PANEL_WIDTH = '440px';

function severityAccent(colors: LogColors, severity: string): string | undefined {
  const group = severityGroup(severity);
  return group === 'error' || group === 'fatal' || group === 'warning'
    ? colors.severity[group]
    : undefined;
}

function LevelLabel({ severity, colors }: { severity: string; colors: LogColors }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 600 }}>
      <Box
        component="span"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: colors.severity[severityGroup(severity)],
        }}
      />
      <span>{severity || '-'}</span>
    </Box>
  );
}

/**
 * Label/value pairs as a striped table: fixed label column, faint alternating rows and
 * monospace values (mostly ids, addresses and timestamps).
 */
function FieldTable({ rows }: { rows: [string, string][] }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {rows.map(([label, value], index) => (
        <Box
          key={label}
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 2,
            px: 1.5,
            py: 0.6,
            bgcolor: index % 2 === 1 ? 'action.hover' : 'transparent',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ width: 120, flexShrink: 0 }}>
            {label}
          </Typography>
          <Typography
            variant="body2"
            sx={{ minWidth: 0, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}
          >
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function PanelIconButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      {/* The span keeps the tooltip working while the button is disabled. */}
      <span>
        <IconButton size="small" aria-label={label} onClick={onClick} disabled={disabled}>
          <Icon icon={icon} width={20} height={20} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

// Diagnostic text fields of a record, in display order (as in the per-pod viewer's
// "PostgreSQL context").
const CONTEXT_BLOCKS: [string, (entry: PostgresLogEntry) => string | undefined][] = [
  ['query', entry => entry.query],
  ['detail', entry => entry.detail],
  ['hint', entry => entry.hint],
  ['context', entry => entry.context],
  ['internal_query', entry => entry.internalQuery],
];

/**
 * The selected log beside the table, laid out like the per-pod viewer's "Selected event" panel.
 * The header (prev/next, close) stays pinned while the body scrolls.
 */
function LogDetailPanel({
  entry,
  index,
  total,
  role,
  container,
  showCategories,
  colors,
  onClose,
  onPrevious,
  onNext,
  onShowCategory,
}: {
  entry: PostgresLogEntry;
  /** Position in the listed rows; -1 if filters have since hidden it. */
  index: number;
  total: number;
  role: string | undefined;
  container: string;
  showCategories: boolean;
  colors: LogColors;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onShowCategory: (category: LogCategory) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => prettyJson(entry.raw), [entry.raw]);

  // Stepping to another log resets "Copied"; the JSON view stays open.
  useEffect(() => setCopied(false), [entry.key]);

  const context = CONTEXT_BLOCKS.map(([label, get]) => [label, get(entry)] as const).filter(
    ([, text]) => text
  );

  const eventRows: [string, string][] = [
    ['Severity', entry.severity || '-'],
    ['Timestamp', new Date(entry.time).toISOString()],
  ];
  if (showCategories) {
    eventRows.push(['Category', LOG_CATEGORY_LABELS[entry.category]]);
  } else if (entry.logger) {
    eventRows.push(['Logger', entry.logger]);
  }
  eventRows.push(['Container', container], ['Pod', role ? `${entry.pod} (${role})` : entry.pod]);

  const copy = () => {
    navigator.clipboard?.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: 'background.paper',
          pl: 2,
          pr: 1,
          py: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ flex: 1, lineHeight: 1.6, letterSpacing: 0.8 }}
        >
          Selected event
          {index >= 0 && (
            <Box component="span" sx={{ ml: 1, textTransform: 'none', letterSpacing: 0 }}>
              {formatCount(index + 1)} of {formatCount(total)}
            </Box>
          )}
        </Typography>
        <PanelIconButton
          label="Previous log"
          icon="mdi:chevron-up"
          onClick={onPrevious}
          disabled={!onPrevious}
        />
        <PanelIconButton
          label="Next log"
          icon="mdi:chevron-down"
          onClick={onNext}
          disabled={!onNext}
        />
        <PanelIconButton label="Close" icon="mdi:close" onClick={onClose} />
      </Box>

      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LevelLabel severity={entry.severity} colors={colors} />
          {showCategories && (
            <Chip
              size="small"
              variant="outlined"
              label={
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  <Box
                    component="span"
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '2px',
                      bgcolor: colors.category[entry.category],
                    }}
                  />
                  {LOG_CATEGORY_LABELS[entry.category]}
                </Box>
              }
            />
          )}
        </Box>
        <Box component="pre" sx={{ ...codeSx, mt: 1 }}>
          {entry.message}
        </Box>

        {entry.category === 'locks' && (
          <Box sx={{ mt: 1 }}>
            <Button size="small" onClick={() => onShowCategory('locks')}>
              View related lock waits →
            </Button>
          </Box>
        )}

        <DetailSection title="Event" divider={false}>
          <FieldTable rows={eventRows} />
        </DetailSection>

        {context.length > 0 && (
          <DetailSection title="PostgreSQL context" divider={false}>
            {context.map(([label, text]) => (
              <Box key={label} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Box component="pre" sx={codeSx}>
                  {text}
                </Box>
              </Box>
            ))}
          </DetailSection>
        )}

        {entry.fields.length > 0 && (
          <DetailSection title="Parsed fields" divider={false}>
            <FieldTable rows={entry.fields} />
          </DetailSection>
        )}

        <DetailSection title="JSON" divider={false}>
          <Box sx={{ mb: 1 }}>
            <Button
              size="small"
              aria-expanded={showJson}
              endIcon={<Icon icon={showJson ? 'mdi:chevron-up' : 'mdi:chevron-down'} />}
              onClick={() => setShowJson(value => !value)}
            >
              {showJson ? 'Hide JSON' : 'View JSON'}
            </Button>
          </Box>
          {showJson && (
            // Copy sits inside the block it copies; extra top padding keeps the first lines clear.
            <Box sx={{ position: 'relative' }}>
              <Button
                size="small"
                startIcon={<Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />}
                onClick={copy}
                sx={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  zIndex: 1,
                  bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'background.paper' },
                }}
              >
                {copied ? 'Copied' : 'Copy JSON'}
              </Button>
              <Box component="pre" sx={{ ...codeSx, pt: 5 }}>
                {json}
              </Box>
            </Box>
          )}
        </DetailSection>
      </Box>
    </>
  );
}

function LogRow({
  entry,
  selected,
  role,
  showCategories,
  colors,
  onSelect,
}: {
  entry: PostgresLogEntry;
  selected: boolean;
  role: string | undefined;
  showCategories: boolean;
  colors: LogColors;
  onSelect: (entry: PostgresLogEntry) => void;
}) {
  const accent = severityAccent(colors, entry.severity);
  const group = severityGroup(entry.severity);
  const isProblem = group === 'error' || group === 'fatal';

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(entry);
    }
  };

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(entry)}
      onKeyDown={onKeyDown}
      sx={{
        display: 'grid',
        gridTemplateColumns: STREAM_COLUMNS,
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.75,
        cursor: 'pointer',
        fontSize: 12,
        borderBottom: '1px solid',
        borderColor: 'divider',
        borderLeft: '3px solid',
        borderLeftColor: accent ?? 'transparent',
        bgcolor: theme =>
          selected
            ? 'action.selected'
            : isProblem
            ? alpha(accent as string, theme.palette.mode === 'dark' ? 0.1 : 0.05)
            : 'transparent',
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: -2,
        },
        ...(selected && { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 }),
      }}
    >
      <Box component="span" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
        {formatLogTimestamp(entry.time)}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <InstanceChip name={entry.pod} role={role} colors={colors} />
        {role && (
          <Typography
            variant="caption"
            sx={{ flexShrink: 0, fontWeight: 600, color: roleColor(colors, role) }}
          >
            {role}
          </Typography>
        )}
      </Box>
      {showCategories ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Box
            component="span"
            sx={{
              width: 8,
              height: 8,
              borderRadius: '2px',
              flexShrink: 0,
              bgcolor: colors.category[entry.category],
            }}
          />
          <Box
            component="span"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {LOG_CATEGORY_LABELS[entry.category]}
          </Box>
        </Box>
      ) : (
        <Box
          component="span"
          title={entry.logger}
          sx={{
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.logger ?? '-'}
        </Box>
      )}
      <LevelLabel severity={entry.severity} colors={colors} />
      <Box
        component="span"
        title={entry.message}
        sx={{
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.message}
      </Box>
    </Box>
  );
}

interface ListSnapshot {
  resetKey: string;
  rows: PostgresLogEntry[];
  counts: Record<LogCategory, number>;
}

export function LogStream({
  rows,
  categoryCounts,
  selectedCategories,
  onToggleCategory,
  onShowCategory,
  live,
  container,
  showCategories,
  roleByPod,
  resetKey,
  emptyMessage,
}: {
  rows: PostgresLogEntry[];
  /** Per-category counts for the current filters, ignoring the category selection. */
  categoryCounts: Record<LogCategory, number>;
  selectedCategories: ReadonlySet<LogCategory>;
  onToggleCategory: (category: LogCategory) => void;
  onShowCategory: (category: LogCategory) => void;
  live: boolean;
  container: string;
  /** Postgres records have categories; other containers' lines have a logger instead. */
  showCategories: boolean;
  roleByPod: Map<string, string>;
  /** Changes whenever the filters change, so the stream returns to page 1. */
  resetKey: string;
  emptyMessage: ReactNode;
}) {
  const colors = useLogColors();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // The panel keeps its own copy, so live updates or filters moving the row don't affect it.
  const [selected, setSelected] = useState<PostgresLogEntry | null>(null);

  // While a log is open, hold the list still: newest-first, new lines would push the open row down,
  // even onto another page. The stream keeps collecting; closing the panel (or changing a filter)
  // catches the list up.
  const [snapshot, setSnapshot] = useState<ListSnapshot | null>(null);
  if (selected === null ? snapshot !== null : snapshot === null || snapshot.resetKey !== resetKey) {
    setSnapshot(selected === null ? null : { resetKey, rows, counts: categoryCounts });
  }
  const shownRows = snapshot?.rows ?? rows;
  const shownCounts = snapshot?.counts ?? categoryCounts;
  const newLines = snapshot ? Math.max(0, rows.length - snapshot.rows.length) : 0;

  useEffect(() => setPage(1), [resetKey, pageSize]);

  const hasSelection = selected !== null;
  useEffect(() => {
    if (!hasSelection) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasSelection]);

  const pageCount = Math.max(1, Math.ceil(shownRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visible = shownRows.slice(start, start + pageSize);

  const selectedIndex = useMemo(
    () => (selected ? shownRows.findIndex(row => row.key === selected.key) : -1),
    [shownRows, selected]
  );

  const toggleSelected = (entry: PostgresLogEntry) =>
    setSelected(previous => (previous?.key === entry.key ? null : entry));

  // Stepping can cross a page boundary; follow the selection to its page.
  const step = (offset: number) => {
    const target = shownRows[selectedIndex + offset];
    if (target) {
      setSelected(target);
      setPage(Math.floor((selectedIndex + offset) / pageSize) + 1);
    }
  };

  return (
    // A plain string title keeps Headlamp's heading style; the live pill goes in titleSideActions.
    <SectionBox
      title="Log Stream"
      headerProps={{
        titleSideActions: [
          <Chip
            key="live-state"
            size="small"
            variant="outlined"
            label={live ? '● live' : 'paused'}
            sx={{
              height: 20,
              fontSize: 11,
              color: live ? colors.ok : 'text.secondary',
              borderColor: live ? colors.ok : 'divider',
            }}
          />,
        ],
      }}
    >
      {showCategories && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          {LOG_CATEGORIES.filter(
            category => shownCounts[category.id] > 0 || selectedCategories.has(category.id)
          ).map(category => {
            const isSelected = selectedCategories.has(category.id);
            return (
              <Tooltip key={category.id} title={category.description}>
                <Chip
                  size="small"
                  clickable
                  aria-pressed={isSelected}
                  variant={isSelected ? 'filled' : 'outlined'}
                  color={isSelected ? 'primary' : 'default'}
                  onClick={() => onToggleCategory(category.id)}
                  label={
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                      <Box
                        component="span"
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '2px',
                          bgcolor: colors.category[category.id],
                        }}
                      />
                      {category.label}
                      <Box component="span" sx={{ fontWeight: 700 }}>
                        {formatCount(shownCounts[category.id])}
                      </Box>
                    </Box>
                  }
                />
              </Tooltip>
            );
          })}
        </Box>
      )}

      {newLines > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          List paused while a log is open. {formatCount(newLines)} new{' '}
          {newLines === 1 ? 'line' : 'lines'} arrived; close the panel to catch up.
        </Typography>
      )}

      <Box
        sx={{
          display: 'flex',
          flexWrap: { xs: 'wrap', md: 'nowrap' },
          alignItems: 'flex-start',
          gap: 2,
        }}
      >
        <Box sx={{ flex: '1 1 0', minWidth: 0, width: { xs: '100%', md: 'auto' } }}>
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              overflowX: 'auto',
            }}
          >
            <Box sx={{ minWidth: 800 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: STREAM_COLUMNS,
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  // Lines up with the rows, which have the same padding plus a 3px accent border.
                  pl: 'calc(8px + 3px)',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'action.hover',
                }}
              >
                {[
                  'Timestamp',
                  'Instance',
                  showCategories ? 'Category' : 'Logger',
                  'Level',
                  'Event',
                ].map(label => (
                  <Typography
                    key={label}
                    variant="overline"
                    color="text.secondary"
                    sx={{ lineHeight: 1.6, letterSpacing: 0.8 }}
                  >
                    {label}
                  </Typography>
                ))}
              </Box>

              {visible.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    {emptyMessage}
                  </Typography>
                </Box>
              ) : (
                visible.map(entry => (
                  <LogRow
                    key={entry.key}
                    entry={entry}
                    selected={selected?.key === entry.key}
                    role={roleByPod.get(entry.pod)}
                    showCategories={showCategories}
                    colors={colors}
                    onSelect={toggleSelected}
                  />
                ))
              )}
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              mt: 1.5,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {shownRows.length === 0
                ? '0 lines'
                : `${formatCount(start + 1)}–${formatCount(
                    start + visible.length
                  )} of ${formatCount(shownRows.length)} lines`}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Pagination
                size="small"
                shape="rounded"
                count={pageCount}
                page={currentPage}
                onChange={(_, value) => setPage(value)}
              />
              <Select
                size="small"
                value={pageSize}
                onChange={event => setPageSize(Number(event.target.value))}
                inputProps={{ 'aria-label': 'Lines per page' }}
              >
                {PAGE_SIZES.map(size => (
                  <MenuItem key={size} value={size}>
                    {size} / page
                  </MenuItem>
                ))}
              </Select>
            </Box>
          </Box>
        </Box>

        {selected && (
          <Box
            component="aside"
            aria-label="Log details"
            sx={{
              flex: { xs: '1 1 100%', md: `0 0 ${PANEL_WIDTH}` },
              minWidth: 0,
              // Sticky, so it stays in view while the list scrolls.
              position: { md: 'sticky' },
              top: 8,
              maxHeight: { md: 'calc(100vh - 120px)' },
              overflowY: 'auto',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper',
            }}
          >
            <LogDetailPanel
              entry={selected}
              index={selectedIndex}
              total={shownRows.length}
              role={roleByPod.get(selected.pod)}
              container={container}
              showCategories={showCategories}
              colors={colors}
              onClose={() => setSelected(null)}
              onPrevious={selectedIndex > 0 ? () => step(-1) : undefined}
              onNext={
                selectedIndex >= 0 && selectedIndex < shownRows.length - 1
                  ? () => step(1)
                  : undefined
              }
              onShowCategory={onShowCategory}
            />
          </Box>
        )}
      </Box>
    </SectionBox>
  );
}
