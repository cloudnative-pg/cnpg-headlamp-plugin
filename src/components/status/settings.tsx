import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';
import { NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

export interface PluginConfig {
  /** Namespace cert-manager runs in. Empty means auto-detect by label across all namespaces. */
  certManagerNamespace: string;
}

export const DEFAULT_CONFIG: PluginConfig = { certManagerNamespace: '' };

export const store = new ConfigStore<PluginConfig>('cnpg-headlamp-plugin');

/** The configured cert-manager namespace, or null when detection should be automatic. */
export function useCertManagerNamespace(): string | null {
  const config = store.useConfig()();
  return config?.certManagerNamespace?.trim() || null;
}

export function CnpgSettings() {
  const [namespace, setNamespace] = useState(
    () => store.get()?.certManagerNamespace ?? DEFAULT_CONFIG.certManagerNamespace
  );

  const handleChange = (value: string) => {
    setNamespace(value);
    store.set({ ...DEFAULT_CONFIG, ...store.get(), certManagerNamespace: value.trim() });
  };

  return (
    <Box style={{ paddingTop: '8vh' }}>
      <Typography variant="h6">Installation detection</Typography>
      <NameValueTable
        rows={[
          {
            name: 'cert-manager namespace',
            value: (
              <TextField
                size="small"
                fullWidth
                value={namespace}
                onChange={e => handleChange(e.target.value)}
                placeholder="Auto-detect"
                helperText="Set this if cert-manager isn't detected, e.g. it was installed with a custom name or label. Leave empty to auto-detect."
              />
            ),
          },
        ]}
      />
    </Box>
  );
}
