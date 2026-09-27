import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { ResourceListView, StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useHistory } from 'react-router-dom';
import { Cluster } from '../../resources/cluster';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { PodStatusLabel } from '../common/podActions';

const { createRouteURL } = Router;

// One compact status pill per instance pod, same renderer used in the Cluster detail page's
// Instances section (see PodStatusLabel in common/podActions.tsx for why it isn't a direct import
// of Headlamp's own pod-list status component).
function InstanceStatusPills({ cluster }: { cluster: Cluster }) {
  const [pods] = K8s.ResourceClasses.Pod.useList({
    namespace: cluster.getNamespace(),
    labelSelector: `cnpg.io/cluster=${cluster.getName()},cnpg.io/podRole=instance`,
  });

  return (
    <Box display="flex" flexWrap="wrap" gap={0.5}>
      {(pods ?? []).map(pod => (
        <Box key={pod.metadata.uid}>
          <PodStatusLabel pod={pod} showContainerStatus={false} />
        </Box>
      ))}
    </Box>
  );
}

export function ClustersList() {
  const history = useHistory();
  return (
    <ResourceListView
      title="Clusters"
      resourceClass={Cluster}
      headerProps={{
        // ResourceListView auto-injects Headlamp's own generic CreateResourceButton next to the
        // title whenever resourceClass is set and titleSideActions isn't — suppress it here
        // since our guided create form below already covers that slot via actions.
        titleSideActions: [],
        actions: [
          <AuthDisabledButton
            key="create-cluster"
            item={Cluster}
            authVerb="create"
            deniedMessage="You don't have permission to create Clusters."
          >
            <Button
              variant="contained"
              color="primary"
              onClick={() => history.push(createRouteURL('CNPG Cluster New'))}
            >
              Create / Restore Cluster
            </Button>
          </AuthDisabledButton>,
        ],
      }}
      columns={[
        'name',
        'namespace',
        {
          id: 'health',
          label: 'Health',
          getValue: item => item.healthLabel,
          render: item => <StatusLabel status={item.health}>{item.healthLabel}</StatusLabel>,
        },
        {
          id: 'phase',
          label: 'Phase',
          getValue: item => item.phase ?? '',
        },
        {
          id: 'primary',
          label: 'Primary',
          getValue: item => item.currentPrimary ?? '',
        },
        {
          id: 'instances',
          label: 'Instances',
          getValue: item => `${item.readyInstances}/${item.instances}`,
          render: item => <InstanceStatusPills cluster={item} />,
        },
        {
          id: 'synchronousReplication',
          label: 'Sync Replication',
          getValue: item => (item.hasSynchronousReplication ? 'Yes' : 'No'),
          render: item =>
            item.instances > 1 && !item.hasSynchronousReplication ? (
              <StatusLabel status="warning">Off</StatusLabel>
            ) : item.hasSynchronousReplication ? (
              <StatusLabel status="success">On</StatusLabel>
            ) : (
              'N/A'
            ),
        },
        'age',
      ]}
    />
  );
}
