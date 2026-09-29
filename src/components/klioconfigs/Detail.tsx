import {
  DetailsGrid,
  ResourceLink,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useParams } from 'react-router-dom';
import { Cluster } from '../../resources/cluster';
import {
  KlioConfigCondition,
  KlioRetentionPolicy,
  PluginConfiguration,
} from '../../resources/pluginConfiguration';

const RETENTION_LEVELS = [
  'keepLatest',
  'keepHourly',
  'keepDaily',
  'keepWeekly',
  'keepMonthly',
  'keepAnnual',
] as const;

function RetentionSection({
  title,
  retention,
}: {
  title: string;
  retention: KlioRetentionPolicy | undefined;
}) {
  if (!retention) {
    return null;
  }

  return (
    <SectionBox title={title}>
      <SimpleTable
        columns={[
          {
            label: 'Level',
            getter: ({ level }: { level: string }) => level,
          },
          {
            label: 'Keep',
            getter: ({ level }: { level: string }) =>
              retention[level as (typeof RETENTION_LEVELS)[number]]?.toString() ?? 'default',
          },
        ]}
        data={RETENTION_LEVELS.map(level => ({ level }))}
      />
    </SectionBox>
  );
}

function ConditionsSection({ config }: { config: PluginConfiguration }) {
  const conditions = config.getConditions();

  if (conditions.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Conditions">
      <SimpleTable
        columns={[
          {
            label: 'Type',
            getter: (condition: KlioConfigCondition) => condition.type,
          },
          {
            label: 'Status',
            getter: (condition: KlioConfigCondition) => condition.status,
          },
          {
            label: 'Reason',
            getter: (condition: KlioConfigCondition) => condition.reason ?? '-',
          },
          {
            label: 'Message',
            getter: (condition: KlioConfigCondition) => condition.message ?? '-',
          },
        ]}
        data={conditions}
      />
    </SectionBox>
  );
}

function ReferringClustersSection({ config }: { config: PluginConfiguration }) {
  // Clusters reference a PluginConfiguration by name in
  // spec.plugins[]/spec.externalClusters[] rather than a label, so we fetch every Cluster in
  // the namespace and filter client-side — same pattern as PoolersSection in clusters/Detail.tsx.
  const [allClusters] = Cluster.useList({ namespace: config.getNamespace() });
  const referringClusters = allClusters?.filter(
    cluster =>
      cluster.referencesKlioConfigAsBackup(config.getName()) ||
      cluster.referencesKlioConfigAsRecoverySource(config.getName())
  );

  if (referringClusters && referringClusters.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Referring Clusters">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            // ResourceLink defaults its route lookup to resource.kind ('Cluster'), but our route
            // is registered as 'CNPG Cluster' (see index.tsx) to dodge a naming collision —
            // so the default lookup fails silently and needs this explicit override, same as
            // PoolersSection in clusters/Detail.tsx.
            getter: (cluster: Cluster) => (
              <ResourceLink resource={cluster} routeName="CNPG Cluster" />
            ),
          },
          {
            label: 'Backup Destination',
            getter: (cluster: Cluster) =>
              cluster.referencesKlioConfigAsBackup(config.getName()) ? 'Yes' : '-',
          },
          {
            label: 'Recovery Source',
            getter: (cluster: Cluster) =>
              cluster.referencesKlioConfigAsRecoverySource(config.getName()) ? 'Yes' : '-',
          },
        ]}
        data={referringClusters ?? []}
      />
    </SectionBox>
  );
}

export function KlioConfigDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <DetailsGrid
      resourceType={PluginConfiguration}
      name={name}
      namespace={namespace}
      extraInfo={item =>
        item && [
          {
            name: 'Server Address',
            value: item.serverAddress,
          },
          {
            name: 'Cluster',
            value: item.clusterName,
          },
          {
            name: 'Mode',
            value: item.mode,
          },
          {
            name: 'Client Secret',
            value: item.clientSecretName,
          },
          {
            name: 'Server Secret',
            value: item.serverSecretName,
          },
          {
            name: 'Tier 2 Backup',
            value: item.tier2BackupEnabled ? 'Enabled' : 'Disabled',
          },
          {
            name: 'Tier 2 Recovery',
            value: item.tier2RecoveryEnabled ? 'Enabled' : 'Disabled',
          },
          {
            name: 'Configuration Applied',
            value:
              item.isConfigurationApplied === undefined
                ? '-'
                : item.isConfigurationApplied
                  ? 'True'
                  : 'False',
          },
        ]
      }
      extraSections={item =>
        item && [
          {
            id: 'referring-clusters',
            section: <ReferringClustersSection config={item} />,
          },
          {
            id: 'tier1-retention',
            section: (
              <RetentionSection title="Tier 1 Retention" retention={item.spec.tier1?.retention} />
            ),
          },
          {
            id: 'tier2-retention',
            section: (
              <RetentionSection title="Tier 2 Retention" retention={item.spec.tier2?.retention} />
            ),
          },
          {
            id: 'conditions',
            section: <ConditionsSection config={item} />,
          },
        ]
      }
    />
  );
}
