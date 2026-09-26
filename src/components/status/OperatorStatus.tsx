import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  ResourceLink,
  SectionBox,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { Pod, PodStatusLabel } from '../common/podActions';
import { ViewLogsButton } from '../common/podLogs';

type Crd = InstanceType<typeof K8s.ResourceClasses.CustomResourceDefinition>;

// The two API groups CNPG's own CRDs and the Barman Cloud plugin's ObjectStore CRD register
// under. Every CRD listed here is one this plugin already knows how to display/manage elsewhere
// (see the sidebar), so this section only ever reports install status — it never offers to
// create/manage the CRDs themselves.
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

function CrdGroupSection({
  group,
  label,
  crdNames,
  crds,
}: {
  group: string;
  label: string;
  crdNames: string[];
  crds: Crd[] | null;
}) {
  const suffix = `.${group}`;
  const installed = (crds ?? []).filter(crd => crd.getName().endsWith(suffix));
  const isInstalled = installed.length > 0;

  return (
    <SectionBox
      title={label}
      headerProps={{
        actions: [
          <StatusLabel key="status" status={isInstalled ? 'success' : 'error'}>
            {isInstalled ? 'Installed' : 'Not installed'}
          </StatusLabel>,
        ],
      }}
    >
      {isInstalled ? (
        <Box display="flex" flexWrap="wrap" gap={1}>
          {installed
            .map(crd => crd.getName())
            .sort((a, b) => a.localeCompare(b))
            .map(name => (
              <Chip key={name} label={name} size="small" variant="outlined" />
            ))}
        </Box>
      ) : (
        <StatusLabel status="error">
          None of the expected CRDs ({crdNames.map(name => `${name}.${group}`).join(', ')}) were
          found on this cluster.
        </StatusLabel>
      )}
    </SectionBox>
  );
}

function CrdSection() {
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();

  return (
    <>
      {CRD_GROUPS.map(({ group, label, crdNames }) => (
        <CrdGroupSection key={group} group={group} label={label} crdNames={crdNames} crds={crds} />
      ))}
    </>
  );
}

/** The tag (or digest) portion of a container image reference, e.g. "1.24.1" from
 * "ghcr.io/cloudnative-pg/cloudnative-pg:1.24.1". Falls back to the full image string when no
 * tag/digest can be identified, rather than guessing. */
function getImageVersion(image: string | undefined): string {
  if (!image) {
    return '-';
  }
  const lastSegment = image.split('/').pop() ?? image;
  const [, tag] = lastSegment.split(':');
  return tag ?? image;
}

function OperatorPodsSection() {
  // The operator's own pods, wherever they've been installed — no namespace filter, since the
  // roadmap explicitly calls out not hardcoding e.g. cnpg-system.
  const [pods] = K8s.ResourceClasses.Pod.useList({
    labelSelector: 'app.kubernetes.io/name=cloudnative-pg',
  });
  const isInstalled = (pods ?? []).length > 0;

  return (
    <SectionBox
      title="Operator"
      headerProps={{
        actions: [
          <StatusLabel key="status" status={isInstalled ? 'success' : 'error'}>
            {isInstalled ? 'Installed' : 'Not installed'}
          </StatusLabel>,
        ],
      }}
    >
      {isInstalled ? (
        <SimpleTable
          columns={[
            { label: 'Namespace', getter: (pod: Pod) => pod.getNamespace() },
            { label: 'Pod', getter: (pod: Pod) => <ResourceLink resource={pod} /> },
            {
              label: 'Version',
              getter: (pod: Pod) => getImageVersion(pod.spec.containers?.[0]?.image),
            },
            { label: 'Status', getter: (pod: Pod) => <PodStatusLabel pod={pod} /> },
            {
              label: 'Actions',
              getter: (pod: Pod) => <ViewLogsButton pod={pod} />,
            },
          ]}
          data={pods ?? []}
        />
      ) : (
        <StatusLabel status="error">
          No pod matching label app.kubernetes.io/name=cloudnative-pg was found in any namespace —
          the CNPG operator does not appear to be installed.
        </StatusLabel>
      )}
    </SectionBox>
  );
}

type Service = InstanceType<typeof K8s.ResourceClasses.Service>;

// A CNPG-i plugin's Service carries cnpg.io/pluginName itself, but that label isn't necessarily
// propagated to the pods it fronts — so we find the plugin via its Service, then follow the
// Service's own selector to the backing Pods, rather than assuming the label reaches them.
function PluginsSection() {
  const [services] = K8s.ResourceClasses.Service.useList({
    labelSelector: 'cnpg.io/pluginName',
  });
  const hasPlugins = (services ?? []).length > 0;

  return (
    <SectionBox title="CNPG-i Plugins">
      {hasPlugins ? (
        (services ?? []).map(service => (
          <PluginPodsSection key={service.metadata.uid} service={service} />
        ))
      ) : (
        <StatusLabel status="">
          No Service carrying a cnpg.io/pluginName label was found — no CNPG-i plugins (e.g. Barman
          Cloud) appear to be installed.
        </StatusLabel>
      )}
    </SectionBox>
  );
}

function PluginPodsSection({ service }: { service: Service }) {
  const pluginName = service.metadata.labels?.['cnpg.io/pluginName'] ?? '-';
  const selector = service.getSelector().join(',');
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: service.getNamespace(),
    labelSelector: selector,
  });

  return (
    <SectionBox
      title={`${pluginName} (${service.getNamespace()}/${service.getName()})`}
      headerProps={{ headerStyle: 'subsection' }}
    >
      <SimpleTable
        columns={[
          { label: 'Namespace', getter: (pod: Pod) => pod.getNamespace() },
          { label: 'Pod', getter: (pod: Pod) => <ResourceLink resource={pod} /> },
          { label: 'Status', getter: (pod: Pod) => <PodStatusLabel pod={pod} /> },
          {
            label: 'Actions',
            getter: (pod: Pod) => <ViewLogsButton pod={pod} />,
          },
        ]}
        data={pods ?? []}
        emptyMessage="No pods matched this Service's selector."
      />
    </SectionBox>
  );
}

export function OperatorStatus() {
  return (
    <>
      <CrdSection />
      <OperatorPodsSection />
      <PluginsSection />
    </>
  );
}
