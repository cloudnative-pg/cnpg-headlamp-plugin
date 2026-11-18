import { SectionFilterHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Namespaced, NamespaceScope, scopeToNamespaces } from './namespaceScope';

export interface SummaryStat {
  value: number;
  label: string;
  highlight?: boolean;
}

/**
 * Summary strip rendered between the list header and the table, same look as the
 * Cluster list page (see components/clusters/List.tsx):
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  8 Clusters     7 Healthy     1 Needs attention     24 Instances       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function SummaryBar({
  stats,
  scope,
}: {
  stats: SummaryStat[];
  /** When the namespace filter hides some items, says so next to the counts. */
  scope?: Pick<NamespaceScope<unknown>, 'namespaces' | 'total'> & { shown: number };
}) {
  const hidden = scope && scope.namespaces.length > 0 && scope.shown < scope.total;
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 3,
        py: 1.5,
        mb: 2,
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 5,
        rowGap: 1,
      }}
    >
      {stats.map(stat => (
        <Box key={stat.label} display="flex" alignItems="baseline" gap={1}>
          <Typography
            variant="h6"
            component="span"
            color={stat.highlight ? 'warning.main' : 'text.primary'}
          >
            {stat.value}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {stat.label}
          </Typography>
        </Box>
      ))}
      {hidden && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: 'auto', alignSelf: 'center' }}
        >
          Showing {scope.shown} of {scope.total} — namespace filter: {scope.namespaces.join(', ')}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Headlamp's selected namespaces (the "Namespace [ ... ]" filter lives in redux and only narrows
 * the table), applied to `items` so a summary counts the same rows the table shows. Same
 * selector the official flux plugin uses.
 */
export function useNamespaceScope<T extends Namespaced>(items: T[] | null): NamespaceScope<T> {
  const selected = useSelector(
    ({ filter }: { filter: { namespaces: Set<string> } }) => filter.namespaces
  );
  return useMemo(() => scopeToNamespaces(items, selected), [items, selected]);
}

/**
 * Custom title for ResourceListView matching the Cluster list page. A custom (non-string)
 * title disables ResourceListView's automatic SectionFilterHeader, so the header is composed
 * manually here: SectionFilterHeader keeps the "Namespace [ All namespaces ]" control, and
 * the summary strip below it sits above the table (ResourceListView renders `children`
 * underneath the table, so the strip can't go there).
 */
export function ListPageHeader<T extends Namespaced>({
  title,
  actions,
  items,
  getStats,
}: {
  title: string;
  actions: ReactNode[];
  /** The list being shown; the namespace filter is applied before computing the stats. */
  items: T[] | null;
  getStats: (items: T[]) => SummaryStat[];
}) {
  const scope = useNamespaceScope(items);
  return (
    <>
      <SectionFilterHeader title={title} titleSideActions={[]} actions={actions} />
      <Box sx={{ px: 2 }}>
        <SummaryBar stats={getStats(scope.items)} scope={{ ...scope, shown: scope.items.length }} />
      </Box>
    </>
  );
}
