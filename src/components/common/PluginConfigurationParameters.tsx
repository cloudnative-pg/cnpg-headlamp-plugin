import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';

export function PluginConfigurationParameters({
  parameters,
}: {
  parameters?: Record<string, string>;
}) {
  if (!parameters || Object.keys(parameters).length === 0) {
    return '';
  }

  return (
    <NameValueTable
      rows={Object.entries(parameters).map(([name, value]) => ({
        name,
        value,
      }))}
    />
  );
}

