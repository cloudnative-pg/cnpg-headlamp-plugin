import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { ObjectStore } from '../../resources/objectStore';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { barmanCloudCrdInstalled, BarmanCloudNotInstalled } from '../common/barmanCloud';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchObjectStoreCreate } from './Create';

function objectStoreStats(stores: ObjectStore[]): SummaryStat[] {
  const total = stores.length;
  const namespaces = new Set(stores.map(s => s.getNamespace())).size;
  return [
    { value: total, label: total === 1 ? 'ObjectStore' : 'ObjectStores' },
    { value: namespaces, label: namespaces === 1 ? 'Namespace' : 'Namespaces' },
  ];
}

function ObjectStoreListTitle() {
  const [stores] = ObjectStore.useList();
  return (
    <ListPageHeader
      title="ObjectStores"
      actions={[
        <AuthDisabledButton
          key="create-objectstore"
          item={ObjectStore}
          authVerb="create"
          allowedNamespacesHint
          deniedMessage="You don't have permission to create ObjectStores."
        >
          <Button variant="contained" color="primary" onClick={() => launchObjectStoreCreate()}>
            Create ObjectStore
          </Button>
        </AuthDisabledButton>,
      ]}
      items={stores}
      getStats={objectStoreStats}
    />
  );
}

export function ObjectStoresList() {
  const [, listError] = ObjectStore.useList();

  if (!barmanCloudCrdInstalled(listError)) {
    return <BarmanCloudNotInstalled title="ObjectStores" />;
  }

  return (
    <ResourceListView
      title={<ObjectStoreListTitle />}
      resourceClass={ObjectStore}
      id="cnpg-object-stores"
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => <Link kubeObject={item} />,
        },
        'namespace',
        {
          id: 'destinationPath',
          label: 'Destination Path',
          getValue: item => item.destinationPath,
        },
        {
          id: 'endpointURL',
          label: 'Endpoint URL',
          getValue: item => item.endpointURL ?? '-',
        },
        {
          id: 'retentionPolicy',
          label: 'Retention Policy',
          getValue: item => item.retentionPolicy ?? '-',
        },
        'age',
      ]}
    />
  );
}
