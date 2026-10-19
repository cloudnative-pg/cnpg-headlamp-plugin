import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  DetailsGrid,
  ResourceLink,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useParams } from 'react-router-dom';
import { Pooler } from '../../resources/pooler';
import { Pod, PodPhaseLabel } from '../common/podActions';
import { ViewLogsButton } from '../common/podLogs';
import { PoolerStatusLabel } from './List';

function PoolerPodsSection({ pooler }: { pooler: Pooler }) {
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: pooler.getNamespace(),
    labelSelector: `cnpg.io/poolerName=${pooler.getName()}`,
  });

  return (
    <SectionBox title="Pods">
      <SimpleTable
        columns={[
          {
            label: 'Name',
            getter: (pod: Pod) => <ResourceLink resource={pod} />,
          },
          {
            label: 'Phase',
            getter: (pod: Pod) => <PodPhaseLabel pod={pod} />,
          },
          {
            label: 'Node',
            getter: (pod: Pod) => pod.spec.nodeName,
          },
          {
            label: 'Actions',
            getter: (pod: Pod) => <ViewLogsButton pod={pod} />,
          },
        ]}
        data={pods ?? []}
      />
    </SectionBox>
  );
}

export function PoolerDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <DetailsGrid
      resourceType={Pooler}
      name={name}
      namespace={namespace}
      extraInfo={item =>
        item && [
          {
            name: 'Status',
            value: <PoolerStatusLabel pooler={item} />,
          },
          {
            name: 'Cluster',
            value: item.clusterName,
          },
          {
            name: 'Type',
            value: item.type,
          },
          {
            name: 'Pool Mode',
            value: item.poolMode,
          },
          {
            name: 'Instances',
            value: item.instances?.toString(),
          },
          {
            name: 'Image',
            value: item.image,
          },
        ]
      }
      extraSections={item =>
        item && [
          {
            id: 'pods',
            section: <PoolerPodsSection pooler={item} />,
          },
        ]
      }
    />
  );
}
