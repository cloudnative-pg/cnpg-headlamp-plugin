import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

export interface PluginConfig {
  /** Namespace cert-manager runs in. Empty means auto-detect by label across all namespaces. */
  certManagerNamespace: string;
  /** Namespace the CloudNativePG operator runs in. Empty means auto-detect by label. */
  operatorNamespace: string;
}

export const DEFAULT_CONFIG: PluginConfig = { certManagerNamespace: '', operatorNamespace: '' };

export const store = new ConfigStore<PluginConfig>('cnpg-headlamp-plugin');

/** The configured cert-manager namespace, or null when detection should be automatic. */
export function useCertManagerNamespace(): string | null {
  const config = store.useConfig()();
  return config?.certManagerNamespace?.trim() || null;
}

/** The configured operator namespace, or null when detection should be automatic. */
export function useOperatorNamespace(): string | null {
  const config = store.useConfig()();
  return config?.operatorNamespace?.trim() || null;
}

function NamespaceField({
  settingKey,
  helperText,
}: {
  settingKey: keyof PluginConfig;
  helperText: string;
}) {
  const [value, setValue] = useState(() => store.get()?.[settingKey] ?? DEFAULT_CONFIG[settingKey]);

  const handleChange = (next: string) => {
    setValue(next);
    store.set({ ...DEFAULT_CONFIG, ...store.get(), [settingKey]: next.trim() });
  };

  return (
    <TextField
      size="small"
      fullWidth
      value={value}
      onChange={e => handleChange(e.target.value)}
      placeholder="Auto-detect"
      helperText={helperText}
    />
  );
}

export function CnpgSettings() {
  return (
    <Box style={{ paddingTop: '8vh' }}>
      <Typography variant="h6">Installation detection</Typography>
      <NameValueTable
        rows={[
          {
            name: 'CloudNativePG operator namespace',
            value: (
              <NamespaceField
                settingKey="operatorNamespace"
                helperText="Set this if the operator isn't detected, e.g. it was installed with a custom name. Leave empty to auto-detect."
              />
            ),
          },
          {
            name: 'cert-manager namespace',
            value: (
              <NamespaceField
                settingKey="certManagerNamespace"
                helperText="Set this if cert-manager isn't detected, e.g. it was installed with a custom name or label. Leave empty to auto-detect."
              />
            ),
          },
        ]}
      />
    </Box>
  );
}
