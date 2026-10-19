import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { ClusterImageCatalog } from '../../resources/imageCatalog';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchClusterImageCatalogCreate } from './Create';

function clusterImageCatalogStats(catalogs: ClusterImageCatalog[]): SummaryStat[] {
  const total = catalogs.length;
  const images = catalogs.reduce((sum, c) => sum + c.images.length, 0);
  return [
    { value: total, label: total === 1 ? 'ClusterImageCatalog' : 'ClusterImageCatalogs' },
    { value: images, label: images === 1 ? 'Image' : 'Images' },
  ];
}

function ClusterImageCatalogListTitle() {
  const [catalogs] = ClusterImageCatalog.useList();
  return (
    <ListPageHeader
      title="ClusterImageCatalogs"
      actions={[
        <AuthDisabledButton
          key="create-clusterimagecatalog"
          item={ClusterImageCatalog}
          authVerb="create"
          deniedMessage="You don't have permission to create ClusterImageCatalogs."
        >
          <Button
            variant="contained"
            color="primary"
            onClick={() => launchClusterImageCatalogCreate()}
          >
            Create ClusterImageCatalog
          </Button>
        </AuthDisabledButton>,
      ]}
      stats={clusterImageCatalogStats(catalogs ?? [])}
    />
  );
}

export function ClusterImageCatalogsList() {
  return (
    <ResourceListView
      title={<ClusterImageCatalogListTitle />}
      resourceClass={ClusterImageCatalog}
      id="cnpg-cluster-image-catalogs"
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => <Link kubeObject={item} />,
        },
        {
          id: 'majorVersions',
          label: 'Major Versions',
          getValue: item => item.images.map(image => image.major).join(', ') || '-',
        },
        'age',
      ]}
    />
  );
}
