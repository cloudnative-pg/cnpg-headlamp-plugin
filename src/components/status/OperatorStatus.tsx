import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  ResourceLink,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import {
  getImageVersion,
  humanizePluginName,
  KNOWN_PLUGIN_CAPABILITIES,
} from '../../resources/status';
import { CnpgLogo } from '../common/CnpgLogo';
import { Pod, PodStatusLabel } from '../common/podActions';
import { ViewLogsButton } from '../common/podLogs';
import { OpenTerminalButton } from '../common/podTerminal';

type Crd = InstanceType<typeof K8s.ResourceClasses.CustomResourceDefinition>;
type Deployment = InstanceType<typeof K8s.ResourceClasses.Deployment>;
type Service = InstanceType<typeof K8s.ResourceClasses.Service>;

const OPERATOR_LABEL = 'app.kubernetes.io/name=cloudnative-pg';
const PLUGIN_LABEL = 'cnpg.io/pluginName';

// The two API groups CNPG's own CRDs and the Barman Cloud plugin's ObjectStore CRD register
// under. Every CRD listed here is one this plugin already knows how to display/manage elsewhere
// (see the sidebar), so the status page only ever reports install status — via the Resources
// summary card's tooltip — and never offers to create/manage the CRDs themselves.
const CRD_GROUPS: { group: string; label: string; crdNames: string[] }[] = [
  {
    group: 'postgresql.cnpg.io',
    label: 'CloudNativePG (postgresql.cnpg.io)',
    crdNames: [
      'backups',
      'clusterimagecatalogs',
      'clusters',
      'databaseroles',
      'databases',
      'failoverquorums',
      'imagecatalogs',
      'poolers',
      'publications',
      'scheduledbackups',
      'subscriptions',
    ],
  },
  {
    group: 'barmancloud.cnpg.io',
    label: 'Barman Cloud plugin (barmancloud.cnpg.io)',
    crdNames: ['objectstores'],
  },
];

type PluginHealth = 'running' | 'degraded';

/** Full "plural.group" names of every CRD this plugin knows how to display (see CRD_GROUPS). */
const EXPECTED_CRD_NAMES: string[] = CRD_GROUPS.flatMap(({ group, crdNames }) =>
  crdNames.map(name => `${name}.${group}`)
);

function countInstalledCrds(crds: Crd[]): number {
  const names = new Set(crds.map(crd => crd.getName()));
  return EXPECTED_CRD_NAMES.filter(name => names.has(name)).length;
}

function isPodReady(pod: Pod): boolean {
  return (
    pod.status.phase === 'Running' &&
    !!pod.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True')
  );
}

// Green check / red cross used for health-style statuses — the same component as the cluster
// details page's healthy box. Headlamp's own success.main is near-white and error.main
// near-black-red in dark mode, so both would be unreadable there — these explicit tones stay
// legible on light and dark backgrounds alike.
function HealthStatusIcon({
  healthy,
  size = 20,
  title,
}: {
  healthy: boolean;
  size?: number;
  title: string;
}) {
  return (
    <Tooltip title={title}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          color: theme =>
            healthy
              ? theme.palette.mode === 'dark'
                ? '#66bb6a'
                : '#2e7d32'
              : theme.palette.mode === 'dark'
              ? '#ef5350'
              : '#c62828',
        }}
      >
        <Icon icon={healthy ? 'mdi:check-circle' : 'mdi:close-circle'} width={size} height={size} />
      </Box>
    </Tooltip>
  );
}

/** Pods backing a plugin Service report readiness for the summary card and the health banner. */
function usePluginHealthReport(
  uid: string,
  health: PluginHealth | null,
  onHealth: ((uid: string, health: PluginHealth) => void) | undefined
) {
  useEffect(() => {
    if (health !== null && onHealth) {
      onHealth(uid, health);
    }
  }, [uid, health, onHealth]);
}

function PodActions({ pod }: { pod: Pod }) {
  return (
    <Box display="flex" gap={1}>
      <ViewLogsButton pod={pod} />
      <OpenTerminalButton pod={pod} />
    </Box>
  );
}

function SummaryCard({
  title,
  headline,
  info,
  children,
}: {
  title: string;
  headline: React.ReactNode;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ position: 'relative' }}>
        {info && (
          <Tooltip title={info}>
            <span style={{ position: 'absolute', top: 8, right: 8, display: 'flex' }}>
              <Icon icon="mdi:information-outline" width={16} height={16} />
            </span>
          </Tooltip>
        )}
        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
          {title}
        </Typography>
        <Box mb={1}>{headline}</Box>
        <Typography variant="body2" component="div" color="textSecondary">
          {children}
        </Typography>
      </CardContent>
    </Card>
  );
}

function OperatorSummaryCard({
  pods,
  deployment,
  loading,
}: {
  pods: Pod[] | null;
  deployment: Deployment | null;
  loading: boolean;
}) {
  if (loading || pods === null) {
    return (
      <SummaryCard title="Operator" headline={<StatusLabel status="">Checking…</StatusLabel>}>
        Looking for the operator pods.
      </SummaryCard>
    );
  }
  if (pods.length === 0) {
    return (
      <SummaryCard
        title="Operator"
        headline={<StatusLabel status="error">Not installed</StatusLabel>}
      >
        No operator pod found.
      </SummaryCard>
    );
  }
  const ready = pods.filter(isPodReady).length;
  const version = getImageVersion(pods[0]?.spec.containers?.[0]?.image);
  const desired: number | undefined = deployment?.spec?.replicas;
  const replicas =
    desired !== undefined ? `${ready} / ${desired} ready` : `${ready} / ${pods.length} ready`;

  return (
    <SummaryCard
      title="Operator"
      headline={
        <StatusLabel status={ready === pods.length ? 'success' : 'warning'}>
          {ready === pods.length ? 'Running' : 'Degraded'}
        </StatusLabel>
      }
    >
      <Box>{version}</Box>
      <Box>{replicas}</Box>
    </SummaryCard>
  );
}

function PluginsSummaryCard({
  services,
  health,
  loading,
}: {
  services: Service[] | null;
  health: Record<string, PluginHealth>;
  loading: boolean;
}) {
  if (loading || services === null) {
    return (
      <SummaryCard title="CNPG-I Plugins" headline={<StatusLabel status="">Checking…</StatusLabel>}>
        Looking for installed plugins.
      </SummaryCard>
    );
  }
  if (services.length === 0) {
    return (
      <SummaryCard title="CNPG-I Plugins" headline={<StatusLabel status="">None</StatusLabel>}>
        No CNPG-i plugins installed.
      </SummaryCard>
    );
  }
  const running = services.filter(s => health[s.metadata.uid ?? ''] !== 'degraded').length;

  return (
    <SummaryCard
      title="CNPG-I Plugins"
      headline={
        <StatusLabel status={running === services.length ? 'success' : 'warning'}>
          {running} / {services.length} Running
        </StatusLabel>
      }
    >
      {services.map(service => {
        const id = service.metadata.labels?.[PLUGIN_LABEL] ?? service.getName();
        const name = humanizePluginName(id);
        const degraded = health[service.metadata.uid ?? ''] === 'degraded';
        return (
          <Box key={service.metadata.uid} display="flex" alignItems="center" gap={1}>
            <HealthStatusIcon
              healthy={!degraded}
              size={18}
              title={degraded ? `${name} is not fully running` : `${name} is running`}
            />
            <span>{name}</span>
          </Box>
        );
      })}
    </SummaryCard>
  );
}

function ResourcesSummaryCard({ crds, loading }: { crds: Crd[] | null; loading: boolean }) {
  if (loading || crds === null) {
    return (
      <SummaryCard title="Resources" headline={<StatusLabel status="">Checking…</StatusLabel>}>
        Looking for installed CRDs.
      </SummaryCard>
    );
  }
  const present = new Set(crds.map(crd => crd.getName()));
  const installedNames = EXPECTED_CRD_NAMES.filter(name => present.has(name));
  const missingNames = EXPECTED_CRD_NAMES.filter(name => !present.has(name));

  return (
    <SummaryCard
      title="Resources"
      headline={
        <StatusLabel status={missingNames.length === 0 ? 'success' : 'warning'}>
          {installedNames.length} CRDs
        </StatusLabel>
      }
      info={
        <Box sx={{ maxWidth: 280 }}>
          <Typography variant="caption" sx={{ display: 'block' }}>
            Installed CRDs
          </Typography>
          <Box
            component="div"
            sx={{ mt: 1, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}
          >
            {installedNames.length > 0 ? installedNames.join('\n') : 'None found.'}
          </Box>
          {missingNames.length > 0 && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
              Missing: {missingNames.join(', ')}
            </Typography>
          )}
        </Box>
      }
    >
      {missingNames.length === 0
        ? '✓ All expected CRDs available'
        : `Expected ${EXPECTED_CRD_NAMES.length} CRDs`}
    </SummaryCard>
  );
}

// Light severity wash for the status banner, following the primary-instance recipe in
// components/clusters/Detail.tsx: explicit tones (which stay legible in dark mode, where MUI's
// own palette mains wash out) at alpha 0.1 in light mode / 0.16 in dark mode.
const BANNER_TONES: Record<
  'success' | 'warning' | 'error' | 'info',
  [light: string, dark: string]
> = {
  success: ['#2e7d32', '#66bb6a'],
  warning: ['#ed6c02', '#ffa726'],
  error: ['#c62828', '#ef5350'],
  info: ['#0288d2', '#29b6f6'],
};

function bannerSx(severity: keyof typeof BANNER_TONES): SxProps<Theme> {
  return {
    backgroundColor: theme => {
      const dark = theme.palette.mode === 'dark';
      return alpha(BANNER_TONES[severity][dark ? 1 : 0], dark ? 0.16 : 0.1);
    },
  };
}

function HealthBanner({
  pods,
  services,
  crds,
  health,
  loading,
}: {
  pods: Pod[] | null;
  services: Service[] | null;
  crds: Crd[] | null;
  health: Record<string, PluginHealth>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Alert severity="info" sx={bannerSx('info')}>
        <AlertTitle>Checking installation status…</AlertTitle>
        Loading operator, plugin and resource data.
      </Alert>
    );
  }
  const operatorPods = pods ?? [];
  if (operatorPods.length === 0) {
    return (
      <Alert severity="error" sx={bannerSx('error')}>
        <AlertTitle>Operator is not installed</AlertTitle>
        No pod matching label {OPERATOR_LABEL} was found in any namespace.
      </Alert>
    );
  }
  const degradedOperator = operatorPods.some(pod => !isPodReady(pod));
  const installed = crds ? countInstalledCrds(crds) : 0;
  const expected = EXPECTED_CRD_NAMES.length;
  const degradedPlugins = (services ?? []).filter(
    service => health[service.metadata.uid ?? ''] === 'degraded'
  );

  if (degradedOperator || degradedPlugins.length > 0 || installed < expected) {
    return (
      <Alert severity="warning" sx={bannerSx('warning')}>
        <AlertTitle>Installation needs attention</AlertTitle>
        {degradedOperator && 'Some operator pods are not ready. '}
        {degradedPlugins.length > 0 &&
          `${degradedPlugins.length} plugin${
            degradedPlugins.length > 1 ? 's are' : ' is'
          } not fully running. `}
        {installed < expected && `${expected - installed} expected CRDs are missing. `}
      </Alert>
    );
  }

  const pluginCount = (services ?? []).length;
  return (
    <Alert severity="success" sx={bannerSx('success')}>
      <AlertTitle>Installation is healthy</AlertTitle>
      {pluginCount > 0
        ? `Operator and all ${pluginCount} installed plugin${
            pluginCount > 1 ? 's are' : ' is'
          } running normally.`
        : 'Operator is running normally. No CNPG-i plugins are installed.'}
    </Alert>
  );
}

function OperatorCard({ pods, deployment }: { pods: Pod[] | null; deployment: Deployment | null }) {
  const installed = (pods ?? []).length > 0;
  const ready = (pods ?? []).filter(isPodReady).length;
  const allReady = installed && ready === (pods ?? []).length;
  const version = installed ? getImageVersion(pods![0]?.spec.containers?.[0]?.image) : '-';
  const namespace = installed ? pods![0]?.getNamespace() : '-';
  const desired: number | undefined = deployment?.spec?.replicas;

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="h6" component="div">
            CloudNativePG Operator
          </Typography>
          {pods !== null && (
            <Box display="flex" alignItems="center" gap={1}>
              <HealthStatusIcon
                healthy={allReady}
                title={
                  !installed
                    ? 'CloudNativePG operator is not installed'
                    : allReady
                    ? 'CloudNativePG operator is running'
                    : 'CloudNativePG operator is degraded'
                }
              />
              <Typography variant="body2" color="textSecondary">
                {!installed ? 'Not installed' : allReady ? 'Running' : 'Degraded'}
              </Typography>
            </Box>
          )}
        </Box>
        {pods === null ? (
          <Typography variant="body2" color="textSecondary">
            Loading operator pods…
          </Typography>
        ) : installed ? (
          <>
            <Box display="flex" flexWrap="wrap" gap={2} mt={1} mb={1}>
              <Typography variant="body2">{version}</Typography>
              <Typography variant="body2" color="textSecondary">
                {namespace}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {desired !== undefined ? `${ready} / ${desired} ready` : `${ready} pods ready`}
              </Typography>
            </Box>
            {deployment && (
              <Typography variant="body2" color="textSecondary">
                Deployment: <ResourceLink resource={deployment} />
              </Typography>
            )}
            <Divider sx={{ my: 1.5 }} />
            <SimpleTable
              columns={[
                { label: 'Pod', getter: (pod: Pod) => <ResourceLink resource={pod} /> },
                { label: 'Status', getter: (pod: Pod) => <PodStatusLabel pod={pod} /> },
                {
                  label: 'Actions',
                  getter: (pod: Pod) => <PodActions pod={pod} />,
                },
              ]}
              data={pods ?? []}
            />
          </>
        ) : (
          <StatusLabel status="error">
            No pod matching label {OPERATOR_LABEL} was found in any namespace — the CNPG operator
            does not appear to be installed.
          </StatusLabel>
        )}
      </CardContent>
    </Card>
  );
}

// A CNPG-i plugin's Service carries cnpg.io/pluginName itself, but that label isn't necessarily
// propagated to the pods it fronts — so we find the plugin via its Service, then follow the
// Service's own selector to the backing Pods, rather than assuming the label reaches them.
function PluginCard({
  service,
  onHealth,
}: {
  service: Service;
  onHealth?: (uid: string, health: PluginHealth) => void;
}) {
  const pluginId = service.metadata.labels?.[PLUGIN_LABEL] ?? service.getName();
  const selector = service.getSelector().join(',');
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: service.getNamespace(),
    labelSelector: selector,
  });

  const ready = (pods ?? []).filter(isPodReady).length;
  const total = (pods ?? []).length;
  // No pods (yet) means we can't confirm the plugin is serving — surface it as degraded rather
  // than claiming it's running.
  const health: PluginHealth | null =
    pods === null ? null : total > 0 && ready === total ? 'running' : 'degraded';
  usePluginHealthReport(service.metadata.uid ?? '', health, onHealth);

  const version = total > 0 ? getImageVersion(pods![0]?.spec.containers?.[0]?.image) : '-';
  const capabilities = KNOWN_PLUGIN_CAPABILITIES[pluginId];

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="h6" component="div">
            {humanizePluginName(pluginId)}
          </Typography>
          {health && (
            <Box display="flex" alignItems="center" gap={1}>
              <HealthStatusIcon
                healthy={health === 'running'}
                title={
                  health === 'running'
                    ? `${humanizePluginName(pluginId)} is running`
                    : total === 0
                    ? `${humanizePluginName(pluginId)} has no pods`
                    : `${humanizePluginName(pluginId)} is degraded`
                }
              />
              <Typography variant="body2" color="textSecondary">
                {health === 'running' ? 'Running' : total === 0 ? 'No pods' : 'Degraded'}
              </Typography>
            </Box>
          )}
        </Box>
        <Typography variant="body2" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
          {pluginId}
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={2} mt={1} mb={1}>
          <Typography variant="body2">{version}</Typography>
          <Typography variant="body2" color="textSecondary">
            {service.getNamespace()}
          </Typography>
          {pods !== null && (
            <Typography variant="body2" color="textSecondary">
              {ready} / {total} pods ready
            </Typography>
          )}
        </Box>
        {capabilities ? (
          <Typography variant="body2" color="textSecondary">
            Capabilities: {capabilities.join(' · ')}
          </Typography>
        ) : (
          <Typography variant="body2" color="textSecondary">
            Service: <ResourceLink resource={service} /> · selector {selector || '—'}
          </Typography>
        )}
        <Divider sx={{ my: 1.5 }} />
        <SimpleTable
          columns={[
            { label: 'Pod', getter: (pod: Pod) => <ResourceLink resource={pod} /> },
            { label: 'Status', getter: (pod: Pod) => <PodStatusLabel pod={pod} /> },
            {
              label: 'Actions',
              getter: (pod: Pod) => <PodActions pod={pod} />,
            },
          ]}
          data={pods ?? []}
          emptyMessage="No pods matched this Service's selector."
        />
      </CardContent>
    </Card>
  );
}

function InstalledComponents({
  pods,
  deployment,
  services,
  onHealth,
}: {
  pods: Pod[] | null;
  deployment: Deployment | null;
  services: Service[] | null;
  onHealth?: (uid: string, health: PluginHealth) => void;
}) {
  return (
    <>
      <Box>
        <Typography variant="h6" component="h2">
          Installed components
        </Typography>
        <Divider />
      </Box>
      <Box display="grid" gap={2} sx={{ gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
        <OperatorCard pods={pods} deployment={deployment} />
        {(services ?? []).map(service => (
          <PluginCard key={service.metadata.uid} service={service} onHealth={onHealth} />
        ))}
      </Box>
      {services !== null && services.length === 0 && (
        <StatusLabel status="">
          No Service carrying a {PLUGIN_LABEL} label was found — no CNPG-i plugins (e.g. Barman
          Cloud) appear to be installed.
        </StatusLabel>
      )}
    </>
  );
}

export function OperatorStatus() {
  // Fetched once here (rather than inside each section) so the banner and the summary cards can
  // all derive from the same data without duplicate queries.
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  // The operator's own pods, wherever they've been installed — no namespace filter, since the
  // roadmap explicitly calls out not hardcoding e.g. cnpg-system.
  const [operatorPods] = K8s.ResourceClasses.Pod.useList({
    labelSelector: OPERATOR_LABEL,
  });
  const [deployments] = K8s.ResourceClasses.Deployment.useList({
    labelSelector: OPERATOR_LABEL,
  });
  const [services] = K8s.ResourceClasses.Service.useList({
    labelSelector: PLUGIN_LABEL,
  });

  // Per-plugin readiness lives in each PluginCard (which owns the pod query); the cards report
  // back up here so the banner and the summary card can reflect degraded plugins.
  const [pluginHealth, setPluginHealth] = useState<Record<string, PluginHealth>>({});
  const handlePluginHealth = useCallback((uid: string, health: PluginHealth) => {
    setPluginHealth(prev => (prev[uid] === health ? prev : { ...prev, [uid]: health }));
  }, []);

  const loading =
    crds === null || operatorPods === null || deployments === null || services === null;

  // Same page padding as the cluster details page, so the title doesn't hug the viewport edge.
  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Same header layout as the cluster details page, but the logo stretches to span the
          full two-line block (top of the title to bottom of the subtitle); width follows the
          SVG aspect ratio. Dark-mode colors come from the shared CnpgLogo component. */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch' }}>
        <Box
          sx={{
            display: 'flex',
            flexShrink: 0,
            '& svg': { height: '100%', width: 'auto', display: 'block' },
          }}
        >
          <CnpgLogo size={36} />
        </Box>
        <Box>
          <Typography variant="h4" component="h1">
            CloudNativePG
          </Typography>
          <Typography variant="subtitle1" color="textSecondary">
            Operator Status
          </Typography>
        </Box>
      </Box>
      {/* Banner title bolded: this is the page's most important box. */}
      <Box sx={{ '& .MuiAlertTitle-root': { fontWeight: 700 } }}>
        <HealthBanner
          pods={operatorPods}
          services={services}
          crds={crds}
          health={pluginHealth}
          loading={loading}
        />
      </Box>
      <Box display="grid" gap={2} sx={{ gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
        <OperatorSummaryCard
          pods={operatorPods}
          deployment={deployments?.[0] ?? null}
          loading={loading}
        />
        <PluginsSummaryCard services={services} health={pluginHealth} loading={loading} />
        <ResourcesSummaryCard crds={crds} loading={loading} />
      </Box>
      <InstalledComponents
        pods={operatorPods}
        deployment={deployments?.[0] ?? null}
        services={services}
        onHealth={handlePluginHealth}
      />
    </Box>
  );
}
