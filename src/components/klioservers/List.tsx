import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { useHistory } from 'react-router-dom';
import { KlioServer } from '../../resources/klioServer';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { KlioNotInstalled, useKlioCrdInstalled } from '../common/klio';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { getKlioServerCreateUrl } from './create/CreatePage';

function klioServerStats(servers: KlioServer[]): SummaryStat[] {
  const total = servers.length;
  const namespaces = new Set(servers.map(s => s.getNamespace())).size;
  const withTier2 = servers.filter(s => s.hasTier2).length;
  return [
    { value: total, label: total === 1 ? 'Server' : 'Servers' },
    { value: namespaces, label: namespaces === 1 ? 'Namespace' : 'Namespaces' },
    { value: withTier2, label: 'With Tier 2' },
  ];
}

function KlioServerListTitle() {
  const history = useHistory();
  const [servers] = KlioServer.useList();
  return (
    <ListPageHeader
      title="Klio Servers"
      actions={[
        <AuthDisabledButton
          key="create-klioserver"
          item={KlioServer}
          authVerb="create"
          deniedMessage="You don't have permission to create Klio Servers."
        >
          <Button
            variant="contained"
            color="primary"
            onClick={() => history.push(getKlioServerCreateUrl())}
          >
            Create Server
          </Button>
        </AuthDisabledButton>,
      ]}
      stats={klioServerStats(servers ?? [])}
    />
  );
}

export function KlioServersList() {
  const klioInstalled = useKlioCrdInstalled();

  // false (not null/loading) specifically — KlioServer.useList() below has nothing to query
  // once we know for sure the CRD backing it isn't there, so show why instead of an empty table.
  if (klioInstalled === false) {
    return <KlioNotInstalled title="Klio Servers" />;
  }

  return (
    <ResourceListView
      title={<KlioServerListTitle />}
      resourceClass={KlioServer}
      id="cnpg-klio-servers"
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => <Link kubeObject={item} />,
        },
        'namespace',
        {
          id: 'mode',
          label: 'Mode',
          getValue: item => item.mode,
        },
        {
          id: 'tier2',
          label: 'Tier 2',
          getValue: item => item.s3BucketName ?? '-',
        },
        {
          id: 'storage',
          label: 'Storage',
          getValue: item => item.storageSize ?? '-',
        },
        {
          id: 'image',
          label: 'Image',
          getValue: item => item.image ?? '-',
        },
        'age',
      ]}
    />
  );
}
