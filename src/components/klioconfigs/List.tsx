import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import { useHistory } from 'react-router-dom';
import { PluginConfiguration } from '../../resources/pluginConfiguration';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { KlioNotInstalled, useKlioCrdInstalled } from '../common/klio';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { getKlioConfigCreateUrl } from './create/CreatePage';

function klioConfigStats(configs: PluginConfiguration[]): SummaryStat[] {
  const total = configs.length;
  const namespaces = new Set(configs.map(c => c.getNamespace())).size;
  return [
    { value: total, label: total === 1 ? 'Client Config' : 'Client Configs' },
    { value: namespaces, label: namespaces === 1 ? 'Namespace' : 'Namespaces' },
  ];
}

function KlioConfigListTitle() {
  const history = useHistory();
  const [configs] = PluginConfiguration.useList();
  return (
    <ListPageHeader
      title="Klio Client Configs"
      actions={[
        <AuthDisabledButton
          key="create-klioconfig"
          item={PluginConfiguration}
          authVerb="create"
          deniedMessage="You don't have permission to create Klio Client Configs."
        >
          <Button
            variant="contained"
            color="primary"
            onClick={() => history.push(getKlioConfigCreateUrl())}
          >
            Create Client Config
          </Button>
        </AuthDisabledButton>,
      ]}
      stats={klioConfigStats(configs ?? [])}
    />
  );
}

export function KlioConfigsList() {
  const klioInstalled = useKlioCrdInstalled();

  // false (not null/loading) specifically — PluginConfiguration.useList() below has nothing to
  // query once we know for sure the CRD backing it isn't there, so show why instead of an
  // empty table.
  if (klioInstalled === false) {
    return <KlioNotInstalled title="Klio Client Configs" />;
  }

  return (
    <ResourceListView
      title={<KlioConfigListTitle />}
      resourceClass={PluginConfiguration}
      id="cnpg-klio-configs"
      columns={[
        {
          id: 'name',
          label: 'Name',
          getValue: item => item.getName(),
          render: item => <Link kubeObject={item} />,
        },
        'namespace',
        {
          id: 'serverAddress',
          label: 'Server Address',
          getValue: item => item.serverAddress,
        },
        {
          id: 'cluster',
          label: 'Cluster',
          getValue: item => item.clusterName,
        },
        {
          id: 'mode',
          label: 'Mode',
          getValue: item => item.mode,
        },
        {
          id: 'tier2',
          label: 'Tier 2',
          getValue: item =>
            [
              item.tier2BackupEnabled ? 'Backup' : '',
              item.tier2RecoveryEnabled ? 'Recovery' : '',
            ]
              .filter(Boolean)
              .join(' + ') || '-',
        },
        'age',
      ]}
    />
  );
}
