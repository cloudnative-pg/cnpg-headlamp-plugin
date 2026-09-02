import { DetailsGrid } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useParams } from 'react-router-dom';
import { Backup } from '../../resources/backup';
import { PluginConfigurationParameters } from '../common/PluginConfigurationParameters';
import { BackupPhaseLabel } from './List';

export function BackupDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <DetailsGrid
      resourceType={Backup}
      name={name}
      namespace={namespace}
      extraInfo={item =>
        item && [
          {
            name: 'Cluster',
            value: item.clusterName,
          },
          {
            name: 'Method',
            value: item.method,
          },
          ...(item.method === 'plugin' || !!item.pluginConfiguration
            ? [
                {
                  name: 'Plugin Name',
                  value: item.pluginConfiguration?.name ?? '',
                },
                {
                  name: 'Plugin Configuration Parameters',
                  value: (
                    <PluginConfigurationParameters
                      parameters={item.pluginConfiguration?.parameters}
                    />
                  ),
                },
              ]
            : []),
          {
            name: 'Target',
            value: item.target ?? 'Cluster default',
          },
          {
            name: 'Phase',
            value: <BackupPhaseLabel backup={item} />,
          },
          {
            name: 'Error',
            value: item.error,
          },
          {
            name: 'Backup ID',
            value: item.status.backupId,
          },
          {
            name: 'Begin WAL',
            value: item.status.beginWal,
          },
          {
            name: 'End WAL',
            value: item.status.endWal,
          },
          {
            name: 'Started At',
            value: item.startedAt,
          },
          {
            name: 'Stopped At',
            value: item.stoppedAt,
          },
        ]
      }
    />
  );
}
