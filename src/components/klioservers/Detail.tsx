import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  DetailsGrid,
  ResourceLink,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useParams } from 'react-router-dom';
import { KlioServer } from '../../resources/klioServer';
import { KlioServerBackupsSection } from './Backups';

type Pvc = InstanceType<typeof K8s.ResourceClasses.PersistentVolumeClaim>;

// The Klio operator labels every PVC it creates for a Server with
// klio.cnpg.io/klio-server=<server-name> (verified live: PVC
// klio-server-sample-klio-0 carries only that label, no ownerReferences),
// so a labelSelector is the reliable way to find them.
function KlioServerPvcsSection({ server }: { server: KlioServer }) {
  const [pvcs] = K8s.ResourceClasses.PersistentVolumeClaim.useList({
    namespace: server.getNamespace(),
    labelSelector: `klio.cnpg.io/klio-server=${server.getName()}`,
  });

  return (
    <SectionBox title="Persistent Volume Claims">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pvc: Pvc) => <ResourceLink resource={pvc} />,
          },
          {
            label: 'Phase',
            getter: (pvc: Pvc) => pvc.status?.phase ?? '-',
          },
          {
            label: 'Capacity',
            getter: (pvc: Pvc) =>
              pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage ?? '-',
          },
          {
            label: 'Access Modes',
            getter: (pvc: Pvc) => (pvc.spec?.accessModes ?? []).join(', ') || '-',
          },
          {
            label: 'Storage Class',
            getter: (pvc: Pvc) => pvc.spec?.storageClassName ?? '-',
          },
        ]}
        data={pvcs ?? []}
      />
    </SectionBox>
  );
}

export function KlioServerDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <DetailsGrid
      resourceType={KlioServer}
      name={name}
      namespace={namespace}
      extraInfo={item =>
        item && [
          {
            name: 'Mode',
            value: item.mode,
          },
          {
            name: 'Image',
            value: item.image,
          },
          {
            name: 'TLS Secret',
            value: item.tlsSecretName,
          },
          {
            name: 'CA Secret',
            value: item.caSecretName,
          },
          {
            name: 'Storage',
            value: item.storageSize,
          },
          {
            name: 'Tier 2 Bucket',
            value: item.s3BucketName,
          },
          {
            name: 'Tier 2 Endpoint',
            value: item.s3Endpoint,
          },
        ]
      }
      extraSections={item =>
        item && [
          {
            id: 'backups',
            section: <KlioServerBackupsSection server={item} />,
          },
          {
            id: 'pvcs',
            section: <KlioServerPvcsSection server={item} />,
          },
        ]
      }
    />
  );
}
