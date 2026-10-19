import { Icon } from '@iconify/react';
import {
  DetailsGrid,
  ResourceLink,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { useHistory, useParams } from 'react-router-dom';
import { Cluster } from '../../resources/cluster';
import { ObjectStore } from '../../resources/objectStore';
import { getClusterCreateUrl } from '../clusters/create/CreatePage';
import { AuthDisabledButton } from '../common/AuthDisabledButton';

function ReferringClustersSection({ objectStore }: { objectStore: ObjectStore }) {
  // Clusters reference an ObjectStore by name in spec.plugins[]/spec.externalClusters[] rather
  // than a label, so we fetch every Cluster in the namespace and filter client-side — same
  // pattern as PoolersSection in clusters/Detail.tsx.
  const [allClusters] = Cluster.useList({ namespace: objectStore.getNamespace() });
  const referringClusters = allClusters?.filter(
    cluster =>
      cluster.referencesObjectStoreAsBackup(objectStore.getName()) ||
      cluster.referencesObjectStoreAsRecoverySource(objectStore.getName())
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
              cluster.referencesObjectStoreAsBackup(objectStore.getName()) ? 'Yes' : '-',
          },
          {
            label: 'Recovery Source',
            getter: (cluster: Cluster) =>
              cluster.referencesObjectStoreAsRecoverySource(objectStore.getName()) ? 'Yes' : '-',
          },
        ]}
        data={referringClusters ?? []}
      />
    </SectionBox>
  );
}

function RecoveryWindowSection({ objectStore }: { objectStore: ObjectStore }) {
  const history = useHistory();
  // status.serverRecoveryWindow is a map keyed by server (cluster) name — the Barman Cloud plugin
  // tracks recovery-window bounds per cluster using this ObjectStore, not per-ObjectStore overall.
  const entries = Object.entries(objectStore.serverRecoveryWindow);

  if (entries.length === 0) {
    return null;
  }

  return (
    <SectionBox title="Recovery Window">
      <SimpleTable
        columns={[
          {
            label: 'Cluster',
            getter: ([serverName]) => serverName,
          },
          {
            label: 'First Recoverability Point',
            getter: ([, window]) => window.firstRecoverabilityPoint ?? '-',
          },
          {
            label: 'Last Successful Backup',
            getter: ([, window]) => window.lastSuccessfulBackupTime ?? '-',
          },
          {
            label: 'Last Failed Backup',
            getter: ([, window]) => window.lastFailedBackupTime ?? '-',
          },
          {
            label: 'Actions',
            // Several clusters can share one ObjectStore, so the row's server name is what
            // pins down which backups to restore. The Barman Cloud plugin needs the recovered
            // Cluster in the ObjectStore's own namespace, so that is pre-filled too.
            getter: ([serverName]) => (
              <AuthDisabledButton
                item={Cluster}
                authVerb="create"
                namespace={objectStore.getNamespace()}
                deniedMessage="You don't have permission to restore Clusters."
              >
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Icon icon="mdi:backup-restore" />}
                  onClick={() =>
                    history.push(
                      getClusterCreateUrl({
                        start: 'recovery',
                        namespace: objectStore.getNamespace(),
                        objectStore: objectStore.getName(),
                        serverName,
                      })
                    )
                  }
                >
                  Recover
                </Button>
              </AuthDisabledButton>
            ),
          },
        ]}
        data={entries}
      />
    </SectionBox>
  );
}

export function ObjectStoreDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <DetailsGrid
      resourceType={ObjectStore}
      name={name}
      namespace={namespace}
      extraInfo={item =>
        item && [
          {
            name: 'Destination Path',
            value: item.destinationPath,
          },
          {
            name: 'Endpoint URL',
            value: item.endpointURL,
          },
          {
            name: 'Retention Policy',
            value: item.retentionPolicy,
          },
        ]
      }
      extraSections={item =>
        item && [
          {
            id: 'referring-clusters',
            section: <ReferringClustersSection objectStore={item} />,
          },
          {
            id: 'recovery-window',
            section: <RecoveryWindowSection objectStore={item} />,
          },
        ]
      }
    />
  );
}
