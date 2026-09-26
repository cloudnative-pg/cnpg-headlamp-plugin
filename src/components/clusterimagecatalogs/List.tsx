import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { ClusterImageCatalog } from '../../resources/imageCatalog';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { launchClusterImageCatalogCreate } from './Create';

export function ClusterImageCatalogsList() {
  return (
    <ResourceListView
      title="ClusterImageCatalogs"
      resourceClass={ClusterImageCatalog}
      headerProps={{
        // ResourceListView auto-injects Headlamp's own generic CreateResourceButton next to the
        // title whenever resourceClass is set and titleSideActions isn't — suppress it here
        // since our guided create form below already covers that slot via actions.
        titleSideActions: [],
        actions: [
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
        ],
      }}
      columns={[
        'name',
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
