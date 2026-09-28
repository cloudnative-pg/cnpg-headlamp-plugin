import type { StorageConfiguration } from '../../../resources/cluster';

export const BARMAN_CLOUD_PLUGIN_NAME = 'barman-cloud.cloudnative-pg.io';
export const KLIO_PLUGIN_NAME = 'klio.cnpg.io';
export const DEFAULT_RECOVERY_EXTERNAL_CLUSTER_NAME = 'recovery-source';

// The operator rejects a Cluster that sets both imageName and imageCatalogRef, so the form
// treats "how is the PostgreSQL image picked" as one mutually-exclusive choice rather than
// three independent optional fields.
export type ImageSource = 'default' | 'catalog' | 'imageName';
export type CatalogKind = 'ImageCatalog' | 'ClusterImageCatalog';

export type StartOption = 'empty' | 'barman-recovery' | 'klio-recovery' | 'custom-recovery';
export type BackupKind = 'barman' | 'custom';
export type SyncMethod = 'any' | 'first';
export type SyncDataDurability = 'required' | 'preferred';

export interface KVRow {
  id: string;
  key: string;
  value: string;
}

export interface TablespaceRow {
  id: string;
  name: string;
  storage: StorageConfiguration;
  temporary: boolean;
}

export interface ClusterCreateFormState {
  namespace: string;
  name: string;
  instances: number;
  startOption: StartOption;
  // Barman-guided recovery (ObjectStore + server filed the backup under).
  recoveryObjectStoreName: string;
  recoveryServerName: string;
  // Custom-plugin recovery: free-form external cluster + plugin.
  recoveryExternalClusterName: string;
  recoveryPluginName: string;
  recoveryPluginParams: KVRow[];
  // Klio-plugin recovery: external cluster + a pluginconfigurations.klio.cnpg.io reference.
  recoveryPluginConfigurationRef: string;
  // PostgreSQL image.
  imageSource: ImageSource;
  imageName: string;
  imageCatalogKind: CatalogKind;
  imageCatalogName: string;
  imageCatalogMajor: string;
  // Parameter presets + free-form extras; empties are stripped before submit.
  paramMaxConnections: string;
  paramSharedBuffers: string;
  paramMaxWalSize: string;
  paramCheckpointTimeout: string;
  extraParams: KVRow[];
  // Synchronous replication. Off (or a single instance) omits spec.postgresql.synchronous.
  syncEnabled: boolean;
  syncMethod: SyncMethod;
  syncNumber: string;
  syncDataDurability: SyncDataDurability;
  // Storage.
  storage: StorageConfiguration;
  useWalStorage: boolean;
  walStorage: StorageConfiguration;
  tablespaces: TablespaceRow[];
  // Backup of the new cluster.
  backupEnabled: boolean;
  backupKind: BackupKind;
  backupObjectStoreName: string;
  backupServerName: string;
  volumeSnapshotEnabled: boolean;
  volumeSnapshotClassName: string;
  backupPluginName: string;
  backupPluginParams: KVRow[];
  backupIsWalArchiver: boolean;
}

export function defaultFormState(): ClusterCreateFormState {
  return {
    namespace: '',
    name: '',
    instances: 3,
    startOption: 'empty',
    recoveryObjectStoreName: '',
    recoveryServerName: '',
    recoveryExternalClusterName: DEFAULT_RECOVERY_EXTERNAL_CLUSTER_NAME,
    recoveryPluginName: '',
    recoveryPluginParams: [],
    recoveryPluginConfigurationRef: '',
    imageSource: 'default',
    imageName: '',
    imageCatalogKind: 'ClusterImageCatalog',
    imageCatalogName: '',
    imageCatalogMajor: '',
    paramMaxConnections: '',
    paramSharedBuffers: '',
    paramMaxWalSize: '',
    paramCheckpointTimeout: '',
    extraParams: [],
    syncEnabled: true,
    syncMethod: 'any',
    syncNumber: '1',
    syncDataDurability: 'required',
    storage: { size: '1Gi' },
    useWalStorage: false,
    walStorage: { size: '1Gi' },
    tablespaces: [],
    backupEnabled: false,
    backupKind: 'barman',
    backupObjectStoreName: '',
    backupServerName: '',
    volumeSnapshotEnabled: false,
    volumeSnapshotClassName: '',
    backupPluginName: '',
    backupPluginParams: [],
    backupIsWalArchiver: true,
  };
}

// 1 / 3 shortcut cards vs. an arbitrary count edited in the HA tab.
export type InstanceCardSelection = '1' | '3' | 'custom';

export function instanceCardSelection(instances: number): InstanceCardSelection {
  if (instances === 1) {
    return '1';
  }
  if (instances === 3) {
    return '3';
  }
  return 'custom';
}

// Merges parameter presets + extra KV rows, stripping empties. Pure for testability.
export function collectParameters(state: ClusterCreateFormState): Record<string, string> {
  const params: Record<string, string> = {};
  const presets: [string, string][] = [
    ['max_connections', state.paramMaxConnections.trim()],
    ['shared_buffers', state.paramSharedBuffers.trim()],
    ['max_wal_size', state.paramMaxWalSize.trim()],
    ['checkpoint_timeout', state.paramCheckpointTimeout.trim()],
  ];
  for (const [key, value] of presets) {
    if (value) {
      params[key] = value;
    }
  }
  for (const row of state.extraParams) {
    const key = row.key.trim();
    if (key) {
      params[key] = row.value;
    }
  }
  return params;
}

function collectPluginParams(rows: KVRow[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) {
      params[key] = row.value;
    }
  }
  return params;
}

// Builds the Cluster manifest from form state — the single source for the YAML preview,
// dry-run validation and the actual submit so the three can never drift apart.
export function buildClusterManifest(state: ClusterCreateFormState) {
  const instances = Math.max(1, Math.floor(state.instances) || 1);

  const spec: Record<string, any> = {
    instances,
    storage: { ...state.storage },
  };

  const postgresql: Record<string, any> = {};
  if (state.syncEnabled && instances > 1) {
    postgresql.synchronous = {
      method: state.syncMethod,
      number: Number(state.syncNumber) || 1,
      dataDurability: state.syncDataDurability,
    };
  }
  const parameters = collectParameters(state);
  if (Object.keys(parameters).length > 0) {
    postgresql.parameters = parameters;
  }
  if (Object.keys(postgresql).length > 0) {
    spec.postgresql = postgresql;
  }

  if (state.imageSource === 'imageName' && state.imageName.trim()) {
    spec.imageName = state.imageName.trim();
  } else if (state.imageSource === 'catalog' && state.imageCatalogName && state.imageCatalogMajor) {
    spec.imageCatalogRef = {
      apiGroup: 'postgresql.cnpg.io',
      kind: state.imageCatalogKind,
      name: state.imageCatalogName,
      major: Number(state.imageCatalogMajor),
    };
  }

  if (state.useWalStorage) {
    spec.walStorage = { ...state.walStorage };
  }

  if (state.tablespaces.length > 0) {
    spec.tablespaces = state.tablespaces.map(t => ({
      name: t.name,
      storage: { ...t.storage },
      ...(t.temporary && { temporary: true }),
    }));
  }

  if (state.backupEnabled) {
    if (state.backupKind === 'barman' && state.backupObjectStoreName) {
      spec.plugins = [
        {
          name: BARMAN_CLOUD_PLUGIN_NAME,
          isWALArchiver: true,
          parameters: {
            barmanObjectName: state.backupObjectStoreName,
            ...(state.backupServerName.trim() && {
              serverName: state.backupServerName.trim(),
            }),
          },
        },
      ];
      if (state.volumeSnapshotEnabled && state.volumeSnapshotClassName) {
        spec.backup = {
          volumeSnapshot: { className: state.volumeSnapshotClassName },
        };
      }
    } else if (state.backupKind === 'custom' && state.backupPluginName.trim()) {
      spec.plugins = [
        {
          name: state.backupPluginName.trim(),
          ...(state.backupIsWalArchiver && { isWALArchiver: true }),
          ...(Object.keys(collectPluginParams(state.backupPluginParams)).length > 0 && {
            parameters: collectPluginParams(state.backupPluginParams),
          }),
        },
      ];
    }
  }

  if (state.startOption === 'barman-recovery') {
    spec.bootstrap = { recovery: { source: DEFAULT_RECOVERY_EXTERNAL_CLUSTER_NAME } };
    spec.externalClusters = [
      {
        name: DEFAULT_RECOVERY_EXTERNAL_CLUSTER_NAME,
        plugin: {
          name: BARMAN_CLOUD_PLUGIN_NAME,
          parameters: {
            barmanObjectName: state.recoveryObjectStoreName,
            serverName: state.recoveryServerName,
          },
        },
      },
    ];
  } else if (state.startOption === 'klio-recovery') {
    const externalName =
      state.recoveryExternalClusterName.trim() || DEFAULT_RECOVERY_EXTERNAL_CLUSTER_NAME;
    spec.bootstrap = { recovery: { source: externalName } };
    spec.externalClusters = [
      {
        name: externalName,
        plugin: {
          name: KLIO_PLUGIN_NAME,
          parameters: {
            pluginConfigurationRef: state.recoveryPluginConfigurationRef,
          },
        },
      },
    ];
  } else if (state.startOption === 'custom-recovery') {
    const externalName =
      state.recoveryExternalClusterName.trim() || DEFAULT_RECOVERY_EXTERNAL_CLUSTER_NAME;
    spec.bootstrap = { recovery: { source: externalName } };
    spec.externalClusters = [
      {
        name: externalName,
        plugin: {
          name: state.recoveryPluginName.trim(),
          ...(Object.keys(collectPluginParams(state.recoveryPluginParams)).length > 0 && {
            parameters: collectPluginParams(state.recoveryPluginParams),
          }),
        },
      },
    ];
  }

  return {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: { name: state.name, namespace: state.namespace },
    spec,
  };
}

export interface ClusterSummary {
  name: string;
  image: string;
  instances: string;
  replication: string;
  storage: string;
  backup: string;
  start: string;
  parameters: string;
}

// Human-readable one-liners for the summary rail. Pure for testability.
export function deriveSummary(state: ClusterCreateFormState): ClusterSummary {
  const name = state.name || '—';

  let image = 'default';
  if (state.imageSource === 'imageName') {
    image = state.imageName.trim() || 'custom (unset)';
  } else if (state.imageSource === 'catalog') {
    image = state.imageCatalogName
      ? `${state.imageCatalogName}:${state.imageCatalogMajor || '?'}`
      : 'catalog (unset)';
  }

  const syncOn = state.syncEnabled && state.instances > 1;
  const replication = syncOn
    ? `sync (${state.syncMethod},${Number(state.syncNumber) || 1})`
    : 'async';

  const storage =
    (state.storage.size || '?') +
    (state.useWalStorage ? ' + WAL' : '') +
    (state.tablespaces.length > 0 ? ` + ${state.tablespaces.length} tbls` : '');

  let backup = 'Disabled';
  if (state.backupEnabled) {
    backup =
      state.backupKind === 'barman'
        ? `Enabled (barman${state.volumeSnapshotEnabled ? ' + snapshots' : ''})`
        : `Enabled (custom${
            state.backupPluginName.trim() ? `: ${state.backupPluginName.trim()}` : ''
          })`;
  }

  const start =
    state.startOption === 'empty'
      ? 'empty'
      : state.startOption === 'barman-recovery'
      ? 'recovery via barman'
      : state.startOption === 'klio-recovery'
      ? 'recovery via klio'
      : 'recovery via custom plugin';

  const params = collectParameters(state);
  const parameters =
    Object.keys(params).length === 0
      ? 'defaults'
      : Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');

  return {
    name,
    image,
    instances: String(Math.max(1, Math.floor(state.instances) || 1)),
    replication,
    storage,
    backup,
    start,
    parameters,
  };
}

// Form-required checks that gate Create. Warnings (instances==2, async with >1, empty
// parameters) are surfaced separately and never block.
export function getValidationErrors(state: ClusterCreateFormState): string[] {
  const errors: string[] = [];
  if (!state.namespace) {
    errors.push('Namespace is required.');
  }
  if (!state.name) {
    errors.push('Name is required.');
  }
  if (!(state.instances >= 1)) {
    errors.push('Instances must be at least 1.');
  }
  if (state.imageSource === 'imageName' && !state.imageName.trim()) {
    errors.push('Image name is required when using a custom image.');
  }
  if (state.imageSource === 'catalog' && (!state.imageCatalogName || !state.imageCatalogMajor)) {
    errors.push('Catalog and major version are required when using an ImageCatalog.');
  }
  if (!state.storage.size) {
    errors.push('PGData storage size is required.');
  }
  if (state.useWalStorage && !state.walStorage.size) {
    errors.push('WAL storage size is required when separate WAL storage is enabled.');
  }
  for (const t of state.tablespaces) {
    if (!t.name || !t.storage.size) {
      errors.push('Each tablespace needs a name and a size.');
      break;
    }
  }
  if (state.startOption === 'barman-recovery') {
    if (!state.recoveryObjectStoreName || !state.recoveryServerName.trim()) {
      errors.push('Recovery ObjectStore and source server are required for Barman recovery.');
    }
  }
  if (state.startOption === 'klio-recovery') {
    if (!state.recoveryExternalClusterName.trim() || !state.recoveryPluginConfigurationRef) {
      errors.push('External cluster name and plugin configuration are required for Klio recovery.');
    }
  }
  if (state.startOption === 'custom-recovery') {
    if (!state.recoveryExternalClusterName.trim() || !state.recoveryPluginName.trim()) {
      errors.push('External cluster name and plugin name are required for custom recovery.');
    }
  }
  if (state.backupEnabled && state.backupKind === 'barman' && !state.backupObjectStoreName) {
    errors.push('Backup ObjectStore is required when Barman backups are enabled.');
  }
  if (state.backupEnabled && state.backupKind === 'custom' && !state.backupPluginName.trim()) {
    errors.push('Plugin name is required when custom backups are enabled.');
  }
  if (state.backupEnabled && state.volumeSnapshotEnabled && !state.volumeSnapshotClassName) {
    errors.push('Volume snapshot class is required when volume snapshots are enabled.');
  }
  return errors;
}

export function getValidationWarnings(state: ClusterCreateFormState): string[] {
  const warnings: string[] = [];
  if (state.instances === 2) {
    warnings.push(
      'With 2 instances, if the primary goes down there is no synchronous replica available until the second instance catches up. Consider 1 (no HA) or 3+ (HA) instead.'
    );
  }
  if (state.instances > 1 && !state.syncEnabled) {
    warnings.push(
      'Asynchronous only — faster writes, but risk of data loss on failover. No sync standby.'
    );
  }
  if (Object.keys(collectParameters(state)).length === 0) {
    warnings.push('No PostgreSQL parameters set — operator defaults will apply.');
  }
  return warnings;
}

export type DryRunState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'passed' }
  | { status: 'failed'; errors: string[] };

// Server-side dry-run, on demand only — never auto-run (it can be slow). The post
// function is injected by the caller (Cluster.apiEndpoint.post in the page) so this
// module stays free of Headlamp runtime imports and stays testable without a cluster.
export async function validateDryRun(
  manifest: object,
  post: (body: object, queryParams?: Record<string, string>) => Promise<unknown>
): Promise<DryRunState> {
  try {
    await post(manifest, { dryRun: 'All' });
    return { status: 'passed' };
  } catch (err) {
    return { status: 'failed', errors: [err instanceof Error ? err.message : String(err)] };
  }
}
