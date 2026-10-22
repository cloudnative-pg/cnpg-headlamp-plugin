import { KlioRetentionPolicy } from '../../../resources/pluginConfiguration';

export type KlioConfigMode = 'standard' | 'read-only';

/** One tier's keep* rules as form strings: '' means "unset" (Kopia default applies). */
export interface KlioRetentionFormState {
  keepLatest: string;
  keepHourly: string;
  keepDaily: string;
  keepWeekly: string;
  keepMonthly: string;
  keepAnnual: string;
}

export interface KlioConfigCreateFormState {
  namespace: string;
  name: string;
  serverAddress: string;
  clientSecretName: string;
  serverSecretName: string;
  clusterName: string;
  mode: KlioConfigMode;
  tier1Retention: KlioRetentionFormState;
  tier2EnableBackup: boolean;
  tier2EnableRecovery: boolean;
  tier2Retention: KlioRetentionFormState;
  walPrefetchCount: string;
  walPrefetchMaxConcurrent: string;
  pprof: boolean;
}

export const RETENTION_LEVELS = [
  'keepLatest',
  'keepHourly',
  'keepDaily',
  'keepWeekly',
  'keepMonthly',
  'keepAnnual',
] as const;

const emptyRetention: KlioRetentionFormState = {
  keepLatest: '',
  keepHourly: '',
  keepDaily: '',
  keepWeekly: '',
  keepMonthly: '',
  keepAnnual: '',
};

export function defaultKlioConfigFormState(): KlioConfigCreateFormState {
  return {
    namespace: '',
    name: '',
    serverAddress: '',
    clientSecretName: '',
    serverSecretName: '',
    clusterName: '',
    mode: 'standard',
    tier1Retention: { ...emptyRetention },
    tier2EnableBackup: false,
    tier2EnableRecovery: false,
    tier2Retention: { ...emptyRetention },
    walPrefetchCount: '',
    walPrefetchMaxConcurrent: '',
    pprof: false,
  };
}

function isRetentionEmpty(retention: KlioRetentionFormState): boolean {
  return RETENTION_LEVELS.every(level => !retention[level]);
}

function buildRetention(retention: KlioRetentionFormState): KlioRetentionPolicy {
  const policy: KlioRetentionPolicy = {};
  for (const level of RETENTION_LEVELS) {
    if (retention[level]) {
      policy[level] = Number(retention[level]);
    }
  }
  return policy;
}

// Builds the PluginConfiguration manifest from form state — shared by the YAML preview and the
// actual submit so the two can never drift apart.
export function buildKlioConfigManifest(state: KlioConfigCreateFormState) {
  const spec: Record<string, any> = {
    serverAddress: state.serverAddress,
    clientSecretName: state.clientSecretName,
    serverSecretName: state.serverSecretName,
    clusterName: state.clusterName,
    mode: state.mode,
  };

  // mode is immutable: read-only configs recover from Tier 2 only — no tier1, no tier2 backups.
  if (state.mode === 'read-only') {
    const tier2: Record<string, any> = { enableRecovery: true };
    if (!isRetentionEmpty(state.tier2Retention)) {
      tier2.retention = buildRetention(state.tier2Retention);
    }
    spec.tier2 = tier2;
  } else {
    if (!isRetentionEmpty(state.tier1Retention)) {
      spec.tier1 = { retention: buildRetention(state.tier1Retention) };
    }
    if (state.tier2EnableBackup || state.tier2EnableRecovery || !isRetentionEmpty(state.tier2Retention)) {
      spec.tier2 = {
        ...(state.tier2EnableBackup && { enableBackup: true }),
        ...(state.tier2EnableRecovery && { enableRecovery: true }),
        ...(!isRetentionEmpty(state.tier2Retention) && {
          retention: buildRetention(state.tier2Retention),
        }),
      };
    }
  }

  if (state.walPrefetchCount || state.walPrefetchMaxConcurrent) {
    spec.walPrefetch = {
      ...(state.walPrefetchCount && { count: Number(state.walPrefetchCount) }),
      ...(state.walPrefetchMaxConcurrent && {
        maxConcurrentDownloads: Number(state.walPrefetchMaxConcurrent),
      }),
    };
  }

  if (state.pprof) {
    spec.pprof = true;
  }

  return {
    apiVersion: 'klio.cnpg.io/v1alpha1',
    kind: 'PluginConfiguration',
    metadata: { name: state.name, namespace: state.namespace },
    spec,
  };
}

export interface KlioConfigSummary {
  name: string;
  server: string;
  cluster: string;
  mode: string;
  tier2: string;
}

export function deriveKlioConfigSummary(state: KlioConfigCreateFormState): KlioConfigSummary {
  const tier2 =
    state.mode === 'read-only'
      ? 'Recovery'
      : [
          state.tier2EnableBackup ? 'Backup' : '',
          state.tier2EnableRecovery ? 'Recovery' : '',
        ]
          .filter(Boolean)
          .join(' + ') || 'Disabled';
  return {
    name: state.name || '-',
    server: state.serverAddress || '-',
    cluster: state.clusterName || '-',
    mode: state.mode,
    tier2,
  };
}

const NON_NEGATIVE_INT_PATTERN = /^(0|[1-9][0-9]*)$/;

function checkRetention(
  retention: KlioRetentionFormState,
  errors: string[],
  message: string
) {
  for (const level of RETENTION_LEVELS) {
    if (retention[level] && !NON_NEGATIVE_INT_PATTERN.test(retention[level])) {
      errors.push(message);
      break;
    }
  }
}

export function getKlioConfigValidationErrors(state: KlioConfigCreateFormState): string[] {
  const errors: string[] = [];
  if (!state.namespace) {
    errors.push('Namespace is required.');
  }
  if (!state.name) {
    errors.push('Name is required.');
  }
  if (!state.serverAddress.trim()) {
    errors.push('Server address is required.');
  }
  if (!state.clientSecretName) {
    errors.push('Client secret is required.');
  }
  if (!state.serverSecretName) {
    errors.push('Server secret is required.');
  }
  if (!state.clusterName.trim()) {
    errors.push('Cluster name is required.');
  }
  if (state.mode === 'read-only') {
    if (!isRetentionEmpty(state.tier1Retention)) {
      errors.push('Tier 1 is not allowed in read-only mode.');
    }
    if (state.tier2EnableBackup) {
      errors.push('Tier 2 backups are not allowed in read-only mode.');
    }
  } else {
    checkRetention(state.tier1Retention, errors, 'Tier 1 retention rules must be whole numbers.');
  }
  checkRetention(state.tier2Retention, errors, 'Tier 2 retention rules must be whole numbers.');
  for (const [value, label] of [
    [state.walPrefetchCount, 'WAL prefetch count'],
    [state.walPrefetchMaxConcurrent, 'WAL prefetch max concurrent downloads'],
  ] as [string, string][]) {
    if (value && !NON_NEGATIVE_INT_PATTERN.test(value)) {
      errors.push(`${label} must be a whole number.`);
    }
  }
  return errors;
}
