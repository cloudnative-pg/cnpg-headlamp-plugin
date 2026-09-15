import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

export type Pod = InstanceType<typeof K8s.ResourceClasses.Pod>;

export function PodPhaseLabel({ pod }: { pod: Pod }) {
  const phase = pod.status.phase;
  switch (phase) {
    case 'Succeeded':
      return <StatusLabel status="success">{phase}</StatusLabel>;
    case 'Failed':
    case 'Unknown':
      return <StatusLabel status="error">{phase}</StatusLabel>;
    case 'Pending':
      return <StatusLabel status="warning">{phase}</StatusLabel>;
    default:
      return <StatusLabel status="">{phase}</StatusLabel>;
  }
}

// Headlamp's own pod list renders a colored circle per container (green running, orange waiting,
// red errored) next to the pod's overall phase — but that renderer (makePodStatusLabel in
// @kinvolk/headlamp-plugin/lib/components/pod/List) isn't reachable from a plugin: it's not
// re-exported from the lib/CommonComponents barrel, and the build tool's external-module mapping
// (config/vite.config.mjs) only has rules for a handful of known deep import paths — anything
// else falls through to a generic rule that strips every "/" from the remaining path segment,
// turning 'components/pod/List' into the global lookup `pluginLib.componentspodList`, which
// doesn't exist and silently resolves to undefined at runtime. So this reimplements just the
// small piece of that logic we need, matching the same color/status rules.
export function PodStatusLabel({
  pod,
  showContainerStatus = true,
}: {
  pod: Pod;
  showContainerStatus?: boolean;
}) {
  const phase = pod.status.phase;
  const isReady = pod.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True');
  const status: 'success' | 'warning' | 'error' =
    phase === 'Failed'
      ? 'error'
      : phase === 'Succeeded' || (phase === 'Running' && isReady)
        ? 'success'
        : 'warning';

  const containerStatuses = pod.status.containerStatuses ?? [];

  return (
    <Box display="flex" alignItems="center" gap={1}>
      <StatusLabel status={status}>{phase}</StatusLabel>
      {showContainerStatus && containerStatuses.length > 0 && (
        <Box display="flex" gap={0.5}>
          {containerStatuses.map(containerStatus => {
            const state = containerStatus.state ?? {};
            let color = 'grey';
            let tooltip = `${containerStatus.name}: unknown`;
            if (state.waiting) {
              color = 'orange';
              tooltip = `${containerStatus.name}: waiting (${state.waiting.reason ?? 'unknown'})`;
            } else if (state.terminated) {
              color = state.terminated.reason === 'Error' ? 'red' : 'green';
              tooltip = `${containerStatus.name}: terminated (${state.terminated.reason ?? 'unknown'})`;
            } else if (state.running) {
              color = 'green';
              tooltip = `${containerStatus.name}: running`;
            }
            return (
              <Tooltip key={containerStatus.name} title={tooltip}>
                <span style={{ display: 'flex' }}>
                  <Icon icon="mdi:circle" style={{ color }} width="0.75rem" height="0.75rem" />
                </span>
              </Tooltip>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
