import { SectionFilterHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

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
export function SummaryBar({ stats }: { stats: SummaryStat[] }) {
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
    </Box>
  );
}

/**
 * Custom title for ResourceListView matching the Cluster list page. A custom (non-string)
 * title disables ResourceListView's automatic SectionFilterHeader, so the header is composed
 * manually here: SectionFilterHeader keeps the "Namespace [ All namespaces ]" control, and
 * the summary strip below it sits above the table (ResourceListView renders `children`
 * underneath the table, so the strip can't go there).
 */
export function ListPageHeader({
  title,
  actions,
  stats,
}: {
  title: string;
  actions: ReactNode[];
  stats: SummaryStat[];
}) {
  return (
    <>
      <SectionFilterHeader title={title} titleSideActions={[]} actions={actions} />
      <Box sx={{ px: 2 }}>
        <SummaryBar stats={stats} />
      </Box>
    </>
  );
}
