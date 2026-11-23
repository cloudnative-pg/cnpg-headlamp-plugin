import type {
  GraphNode,
  GraphSource,
} from '@kinvolk/headlamp-plugin/lib/components/resourceMap/graph/graphModel';
import { useMemo } from 'react';
import { ClusterDetailView } from './components/clusters/Detail';
import { CnpgLogo } from './components/common/CnpgLogo';
import { Cluster } from './resources/cluster';
import { mapNodeStatus } from './resources/status';

export const CNPG_MAP_ICON_COLOR = 'rgb(115, 45, 217)';

// Above Pods, Deployments and HPAs, so the Cluster heads its group.
const CLUSTER_NODE_WEIGHT = 2000;

function ClusterNodeDetails({ node }: { node: GraphNode }) {
  const cluster = node.kubeObject as Cluster;
  return (
    <ClusterDetailView
      name={cluster.getName()}
      namespace={cluster.getNamespace()}
      kubeContext={cluster.cluster}
      embedded
    />
  );
}

// No edges: instance Pods are owned by their Cluster, so Headlamp's own owner relation links them.
const clusterSource: GraphSource = {
  id: 'cnpg-clusters',
  label: 'clusters',
  icon: <CnpgLogo size="100%" />,
  useData() {
    const [clusters, error] = Cluster.useList();

    return useMemo(() => {
      // A failed list (e.g. CRDs not installed) would otherwise keep the map loading.
      if (!clusters) {
        return error ? { nodes: [] } : null;
      }

      const nodes: GraphNode[] = clusters.map(cluster => ({
        id: cluster.metadata.uid,
        kubeObject: cluster,
        weight: CLUSTER_NODE_WEIGHT,
        status: mapNodeStatus(cluster.phaseStatus.severity),
        detailsComponent: ClusterNodeDetails,
      }));

      return { nodes };
    }, [clusters, error]);
  },
};

export const cnpgMapSource: GraphSource = {
  id: 'cnpg',
  label: 'CloudNativePG',
  icon: <CnpgLogo size="100%" />,
  sources: [clusterSource],
};
