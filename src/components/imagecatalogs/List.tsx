import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { ImageCatalog } from '../../resources/imageCatalog';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchImageCatalogCreate } from './Create';

function imageCatalogStats(catalogs: ImageCatalog[]): SummaryStat[] {
  const total = catalogs.length;
  const images = catalogs.reduce((sum, c) => sum + c.images.length, 0);
  return [
    { value: total, label: total === 1 ? 'ImageCatalog' : 'ImageCatalogs' },
    { value: images, label: images === 1 ? 'Image' : 'Images' },
  ];
}

function ImageCatalogListTitle() {
  const [catalogs] = ImageCatalog.useList();
  return (
    <ListPageHeader
      title="ImageCatalogs"
      actions={[
        <AuthDisabledButton
          key="create-imagecatalog"
          item={ImageCatalog}
          authVerb="create"
          deniedMessage="You don't have permission to create ImageCatalogs."
        >
          <Button variant="contained" color="primary" onClick={() => launchImageCatalogCreate()}>
            Create ImageCatalog
          </Button>
        </AuthDisabledButton>,
      ]}
      stats={imageCatalogStats(catalogs ?? [])}
    />
  );
}

export function ImageCatalogsList() {
  return (
    <ResourceListView
      title={<ImageCatalogListTitle />}
      resourceClass={ImageCatalog}
      id="cnpg-image-catalogs"
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => <Link kubeObject={item} />,
        },
        'namespace',
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
