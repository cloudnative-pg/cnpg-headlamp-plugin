import { describe, expect, it, vi } from 'vitest';
import {
  BARMAN_CLOUD_PLUGIN_NAME,
  buildCloneManifest,
  buildClusterManifest,
  cloneSearch,
  collectParameters,
  defaultFormState,
  deriveSummary,
  getValidationErrors,
  initialFormStateFromSearch,
  instanceCardSelection,
  isStaleObjectStoreSelection,
  KLIO_PLUGIN_NAME,
  recoverySearch,
  validateDryRun,
} from './types';

function baseState() {
  return {
    ...defaultFormState(),
    namespace: 'cnpg',
    name: 'production-db',
  };
}

describe('buildClusterManifest', () => {
  it('builds a minimal default manifest with sync replication for 3 instances', () => {
    const manifest = buildClusterManifest(baseState());
    expect(manifest).toMatchObject({
      apiVersion: 'postgresql.cnpg.io/v1',
      kind: 'Cluster',
      metadata: { name: 'production-db', namespace: 'cnpg' },
      spec: {
        instances: 3,
        storage: { size: '1Gi' },
        postgresql: {
          synchronous: { method: 'any', number: 1, dataDurability: 'required' },
        },
      },
    });
  });

  it('treats default image source as neither imageName nor imageCatalogRef', () => {
    const manifest = buildClusterManifest(baseState());
    expect(manifest.spec).not.toHaveProperty('imageName');
    expect(manifest.spec).not.toHaveProperty('imageCatalogRef');
  });

  it('writes imageCatalogRef for the catalog source', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      imageSource: 'catalog',
      imageCatalogKind: 'ClusterImageCatalog',
      imageCatalogName: 'postgresql-stable',
      imageCatalogMajor: '17',
    });
    expect(manifest.spec.imageCatalogRef).toEqual({
      apiGroup: 'postgresql.cnpg.io',
      kind: 'ClusterImageCatalog',
      name: 'postgresql-stable',
      major: 17,
    });
    expect(manifest.spec).not.toHaveProperty('imageName');
  });

  it('writes imageName for the custom source and never both at once', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      imageSource: 'imageName',
      imageName: 'ghcr.io/cloudnative-pg/postgresql:17.6',
      imageCatalogName: 'postgresql-stable',
      imageCatalogMajor: '17',
    });
    expect(manifest.spec.imageName).toBe('ghcr.io/cloudnative-pg/postgresql:17.6');
    expect(manifest.spec).not.toHaveProperty('imageCatalogRef');
  });

  it('omits synchronous config when sync is off', () => {
    const manifest = buildClusterManifest({ ...baseState(), syncEnabled: false });
    expect(manifest.spec.postgresql ?? {}).not.toHaveProperty('synchronous');
  });

  it('omits synchronous config for a single instance even when enabled', () => {
    const manifest = buildClusterManifest({ ...baseState(), instances: 1, syncEnabled: true });
    expect(manifest.spec.postgresql ?? {}).not.toHaveProperty('synchronous');
  });

  it('strips empty parameter presets and blank extra keys', () => {
    const state = {
      ...baseState(),
      paramMaxConnections: '200',
      paramSharedBuffers: '  ',
      extraParams: [
        { id: 'a', key: 'work_mem', value: '8MB' },
        { id: 'b', key: '   ', value: 'ignored' },
      ],
    };
    expect(collectParameters(state)).toEqual({ max_connections: '200', work_mem: '8MB' });
    const manifest = buildClusterManifest(state);
    expect(manifest.spec.postgresql.parameters).toEqual({
      max_connections: '200',
      work_mem: '8MB',
    });
  });

  it('writes barman recovery with the fixed external cluster name', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      startOption: 'barman-recovery',
      recoveryObjectStoreName: 'team-backups',
      recoveryServerName: 'old-cluster',
    });
    expect(manifest.spec.bootstrap).toEqual({ recovery: { source: 'recovery-source' } });
    expect(manifest.spec.externalClusters).toEqual([
      {
        name: 'recovery-source',
        plugin: {
          name: BARMAN_CLOUD_PLUGIN_NAME,
          parameters: { barmanObjectName: 'team-backups', serverName: 'old-cluster' },
        },
      },
    ]);
  });

  it('writes klio recovery with the fixed plugin name and pluginConfigurationRef', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      startOption: 'klio-recovery',
      recoveryExternalClusterName: 'my-source',
      recoveryPluginConfigurationRef: 'my-plugin-config',
    });
    expect(manifest.spec.bootstrap).toEqual({ recovery: { source: 'my-source' } });
    expect(manifest.spec.externalClusters).toEqual([
      {
        name: 'my-source',
        plugin: {
          name: KLIO_PLUGIN_NAME,
          parameters: { pluginConfigurationRef: 'my-plugin-config' },
        },
      },
    ]);
  });

  it('writes custom recovery with user plugin name and params', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      startOption: 'custom-recovery',
      recoveryExternalClusterName: 'my-source',
      recoveryPluginName: 'my-backup.cnpg.io',
      recoveryPluginParams: [{ id: 'a', key: 'bucket', value: 'backups' }],
    });
    expect(manifest.spec.bootstrap).toEqual({ recovery: { source: 'my-source' } });
    expect(manifest.spec.externalClusters).toEqual([
      {
        name: 'my-source',
        plugin: { name: 'my-backup.cnpg.io', parameters: { bucket: 'backups' } },
      },
    ]);
  });

  it('writes barman backup with volume snapshots', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      backupEnabled: true,
      backupKind: 'barman',
      backupObjectStoreName: 'team-backups',
      backupServerName: 'production-db',
      volumeSnapshotEnabled: true,
      volumeSnapshotClassName: 'csi-snap',
    });
    expect(manifest.spec.plugins).toEqual([
      {
        name: BARMAN_CLOUD_PLUGIN_NAME,
        isWALArchiver: true,
        parameters: { barmanObjectName: 'team-backups', serverName: 'production-db' },
      },
    ]);
    expect(manifest.spec.backup).toEqual({ volumeSnapshot: { className: 'csi-snap' } });
  });

  it('writes custom backup plugin with params and archiver flag', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      backupEnabled: true,
      backupKind: 'custom',
      backupPluginName: 'my-backup.cnpg.io',
      backupPluginParams: [{ id: 'a', key: 'bucket', value: 'backups' }],
      backupIsWalArchiver: true,
    });
    expect(manifest.spec.plugins).toEqual([
      {
        name: 'my-backup.cnpg.io',
        isWALArchiver: true,
        parameters: { bucket: 'backups' },
      },
    ]);
    expect(manifest.spec).not.toHaveProperty('backup');
  });

  it('includes WAL storage and tablespaces', () => {
    const manifest = buildClusterManifest({
      ...baseState(),
      useWalStorage: true,
      walStorage: { size: '1Gi', storageClass: 'fast-ssd' },
      tablespaces: [
        { id: 't1', name: 'analytics', storage: { size: '5Gi' }, temporary: false },
        { id: 't2', name: 'scratch', storage: { size: '2Gi' }, temporary: true },
      ],
    });
    expect(manifest.spec.walStorage).toEqual({ size: '1Gi', storageClass: 'fast-ssd' });
    expect(manifest.spec.tablespaces).toEqual([
      { name: 'analytics', storage: { size: '5Gi' } },
      { name: 'scratch', storage: { size: '2Gi' }, temporary: true },
    ]);
  });
});

describe('instanceCardSelection', () => {
  it.each([
    [1, '1'],
    [3, '3'],
    [2, 'custom'],
    [5, 'custom'],
  ])('maps %i instances to %s', (instances, expected) => {
    expect(instanceCardSelection(instances)).toBe(expected);
  });
});

describe('deriveSummary', () => {
  it('derives replication, storage, backup and parameter strings', () => {
    const summary = deriveSummary({
      ...baseState(),
      useWalStorage: true,
      tablespaces: [{ id: 't1', name: 'analytics', storage: { size: '5Gi' }, temporary: false }],
      backupEnabled: true,
      backupKind: 'barman',
      paramMaxConnections: '200',
    });
    expect(summary).toMatchObject({
      name: 'production-db',
      image: 'default',
      instances: '3',
      replication: 'sync (any,1)',
      storage: '1Gi + WAL + 1 tbls',
      backup: 'Enabled (barman)',
      start: 'empty',
    });
    expect(summary.parameters).toContain('max_connections=200');
  });

  it('reports async replication and custom backup plugin', () => {
    const summary = deriveSummary({
      ...baseState(),
      syncEnabled: false,
      backupEnabled: true,
      backupKind: 'custom',
      backupPluginName: 'my-backup.cnpg.io',
    });
    expect(summary.replication).toBe('async');
    expect(summary.backup).toBe('Enabled (custom: my-backup.cnpg.io)');
  });
});

describe('getValidationErrors', () => {
  it('requires namespace, name and barman object stores', () => {
    const errors = getValidationErrors({
      ...defaultFormState(),
      backupEnabled: true,
      backupKind: 'barman',
      startOption: 'barman-recovery',
    });
    expect(errors).toContain('Namespace is required.');
    expect(errors).toContain('Name is required.');
    expect(errors).toContain(
      'Recovery ObjectStore and source server are required for Barman recovery.'
    );
    expect(errors).toContain('Backup ObjectStore is required when Barman backups are enabled.');
  });
});

describe('validateDryRun', () => {
  it('returns passed when the server accepts the manifest', async () => {
    const post = vi.fn().mockResolvedValue({});
    await expect(validateDryRun({}, post)).resolves.toEqual({ status: 'passed' });
    expect(post).toHaveBeenCalledWith({}, { dryRun: 'All' });
  });

  it('returns failed with the server message on rejection', async () => {
    const post = vi.fn().mockRejectedValue(new Error('spec.storage.size: Required value'));
    await expect(validateDryRun({}, post)).resolves.toEqual({
      status: 'failed',
      errors: ['spec.storage.size: Required value'],
    });
  });
});

describe('recovery create-page links', () => {
  const fromObjectStore = { namespace: 'cnpg', objectStore: 'minio-store', serverName: 'old-db' };

  it('keeps the bare ?start=recovery link used by the list page Restore action', () => {
    expect(recoverySearch()).toBe('?start=recovery');
  });

  it('leaves out unset values instead of sending empty params', () => {
    expect(recoverySearch({ objectStore: 'minio-store', serverName: '' })).toBe(
      '?start=recovery&objectStore=minio-store'
    );
  });

  it.each(['', '?start=empty', '?namespace=cnpg&objectStore=minio-store&serverName=old-db'])(
    'opens an empty initdb cluster without start=recovery (%s)',
    search => {
      expect(initialFormStateFromSearch(search)).toEqual(defaultFormState());
    }
  );

  it('opens barman recovery with empty fields for a bare ?start=recovery', () => {
    expect(initialFormStateFromSearch('?start=recovery')).toEqual({
      ...defaultFormState(),
      startOption: 'barman-recovery',
    });
  });

  it('round-trips namespace, ObjectStore and server name from the ObjectStore Recover action', () => {
    expect(initialFormStateFromSearch(recoverySearch(fromObjectStore))).toEqual({
      ...defaultFormState(),
      startOption: 'barman-recovery',
      namespace: 'cnpg',
      recoveryObjectStoreName: 'minio-store',
      recoveryServerName: 'old-db',
    });
  });

  it('leaves only the new cluster name for the user to fill in', () => {
    const state = initialFormStateFromSearch(recoverySearch(fromObjectStore));
    expect(getValidationErrors(state)).toEqual(['Name is required.']);
    expect(getValidationErrors({ ...state, name: 'restored-db' })).toEqual([]);
  });

  it('builds a recovery manifest pointing at the selected store and server', () => {
    const state = initialFormStateFromSearch(recoverySearch(fromObjectStore));
    expect(buildClusterManifest({ ...state, name: 'restored-db' })).toMatchObject({
      metadata: { name: 'restored-db', namespace: 'cnpg' },
      spec: {
        bootstrap: { recovery: { source: 'recovery-source' } },
        externalClusters: [
          {
            name: 'recovery-source',
            plugin: {
              name: BARMAN_CLOUD_PLUGIN_NAME,
              parameters: { barmanObjectName: 'minio-store', serverName: 'old-db' },
            },
          },
        ],
      },
    });
  });
});

describe('buildCloneManifest', () => {
  const sourceSpec = {
    instances: 3,
    storage: { size: '10Gi' },
    postgresql: { parameters: { max_connections: '200' } },
    bootstrap: { recovery: { source: 'some-old-source' } },
    externalClusters: [{ name: 'some-old-source', plugin: { name: 'irrelevant.cnpg.io' } }],
    replica: { enabled: true, source: 'upstream-cluster' },
    certificates: { serverTLSSecret: 'origin-server', replicationTLSSecret: 'origin-replication' },
    superuserSecret: { name: 'origin-superuser' },
  };

  function cloneState(overrides: Partial<ReturnType<typeof defaultFormState>> = {}) {
    return {
      ...defaultFormState(),
      startOption: 'clone-live' as const,
      cloneSourceNamespace: 'cnpg',
      cloneSourceName: 'origin',
      name: 'forked-db',
      ...overrides,
    };
  }

  it('drops the source-specific spec keys and keeps the rest verbatim', () => {
    const manifest = buildCloneManifest(sourceSpec, cloneState());
    expect(manifest.spec).not.toHaveProperty('replica');
    expect(manifest.spec).not.toHaveProperty('certificates');
    expect(manifest.spec).not.toHaveProperty('superuserSecret');
    expect(manifest.spec.instances).toBe(3);
    expect(manifest.spec.storage).toEqual({ size: '10Gi' });
    expect(manifest.spec.postgresql).toEqual({ parameters: { max_connections: '200' } });
  });

  it('bootstraps via pg_basebackup from the source, replacing any inherited externalClusters', () => {
    const manifest = buildCloneManifest(sourceSpec, cloneState());
    expect(manifest.spec.bootstrap).toEqual({ pg_basebackup: { source: 'origin' } });
    expect(manifest.spec.externalClusters).toEqual([
      {
        name: 'origin',
        connectionParameters: {
          host: 'origin-rw.cnpg.svc',
          user: 'streaming_replica',
          sslmode: 'verify-full',
          dbname: 'postgres',
        },
        sslKey: { name: 'origin-replication', key: 'tls.key' },
        sslCert: { name: 'origin-replication', key: 'tls.crt' },
        sslRootCert: { name: 'origin-ca', key: 'ca.crt' },
      },
    ]);
  });

  it('omits spec.replica for a one-shot fork', () => {
    const manifest = buildCloneManifest(sourceSpec, cloneState({ cloneAsReplica: false }));
    expect(manifest.spec).not.toHaveProperty('replica');
  });

  it('sets spec.replica pointing at the source when kept as a replica cluster', () => {
    const manifest = buildCloneManifest(sourceSpec, cloneState({ cloneAsReplica: true }));
    expect(manifest.spec.replica).toEqual({ primary: 'origin', source: 'origin' });
  });

  it('names the new cluster in the source namespace', () => {
    const manifest = buildCloneManifest(sourceSpec, cloneState());
    expect(manifest.metadata).toEqual({ name: 'forked-db', namespace: 'cnpg' });
  });

  it('does not mutate the source spec it was given', () => {
    const original = JSON.parse(JSON.stringify(sourceSpec));
    buildCloneManifest(sourceSpec, cloneState());
    expect(sourceSpec).toEqual(original);
  });

  it('respects the source instance count by default', () => {
    const manifest = buildCloneManifest(sourceSpec, cloneState());
    expect(manifest.spec.instances).toBe(3);
  });

  it('forces a single instance and drops sync replication when requested', () => {
    const manifest = buildCloneManifest(
      { ...sourceSpec, postgresql: { synchronous: { method: 'any', number: 1 } } },
      cloneState({ cloneSingleInstance: true })
    );
    expect(manifest.spec.instances).toBe(1);
    expect(manifest.spec.postgresql).not.toHaveProperty('synchronous');
  });
});

describe('clone create-page links', () => {
  it('builds a query string carrying the source coordinates', () => {
    expect(cloneSearch({ namespace: 'cnpg', sourceName: 'origin' })).toBe(
      '?start=clone-live&namespace=cnpg&sourceName=origin'
    );
  });

  it('lands on the clone-live start option pinned to the source namespace and name', () => {
    expect(
      initialFormStateFromSearch(cloneSearch({ namespace: 'cnpg', sourceName: 'origin' }))
    ).toEqual({
      ...defaultFormState(),
      startOption: 'clone-live',
      namespace: 'cnpg',
      cloneSourceNamespace: 'cnpg',
      cloneSourceName: 'origin',
    });
  });

  it('leaves only the new cluster name for the user to fill in', () => {
    const state = initialFormStateFromSearch(
      cloneSearch({ namespace: 'cnpg', sourceName: 'origin' })
    );
    expect(getValidationErrors(state)).toEqual(['Name is required.']);
    expect(getValidationErrors({ ...state, name: 'forked-db' })).toEqual([]);
  });
});

describe('isStaleObjectStoreSelection', () => {
  const stores = ['minio-store', 'team-backups'];

  it('keeps a store that exists in the selected namespace', () => {
    expect(isStaleObjectStoreSelection('minio-store', stores)).toBe(false);
  });

  it('flags a store missing from the namespace (switched namespace or deleted store)', () => {
    expect(isStaleObjectStoreSelection('gone-store', stores)).toBe(true);
    expect(isStaleObjectStoreSelection('minio-store', [])).toBe(true);
  });

  it('has nothing to clear when no store is selected', () => {
    expect(isStaleObjectStoreSelection('', stores)).toBe(false);
  });

  it.each([null, undefined])(
    'keeps a pre-filled store while the list is still loading (%s)',
    loading => {
      expect(isStaleObjectStoreSelection('minio-store', loading)).toBe(false);
    }
  );
});
