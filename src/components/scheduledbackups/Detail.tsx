import { ActionButton, DetailsGrid } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useParams } from 'react-router-dom';
import { PluginConfigurationParameters } from '../common/PluginConfigurationParameters';
import { ScheduledBackup } from '../../resources/scheduledbackup';
import { ScheduledBackupScheduleLabel, ScheduledBackupSuspendLabel } from './List';
import { launchTriggerBackup } from './TriggerBackup';

export function ScheduledBackupDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <DetailsGrid
      resourceType={ScheduledBackup}
      name={name}
      namespace={namespace}
      actions={item =>
        item && [
          <ActionButton
            key="trigger-backup"
            description="Trigger Backup Now"
            icon="mdi:play-circle-outline"
            onClick={() => launchTriggerBackup(item)}
          />,
        ]
      }
      extraInfo={item =>
        item && [
          {
            name: 'Cluster',
            value: item.clusterName,
          },
          {
            name: 'Schedule',
            value: <ScheduledBackupScheduleLabel schedule={item.schedule} />,
          },
          {
            name: 'Status',
            value: <ScheduledBackupSuspendLabel scheduledBackup={item} />,
          },
          {
            name: 'Backup Owner Reference',
            value: item.backupOwnerReference,
          },
          {
            name: 'Immediate',
            value: item.immediate ? 'Yes' : 'No',
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
            name: 'Last Check Time',
            value: item.lastCheckTime,
          },
          {
            name: 'Last Schedule Time',
            value: item.lastScheduleTime,
          },
          {
            name: 'Next Schedule Time',
            value: item.nextScheduleTime,
          },
        ]
      }
    />
  );
}
