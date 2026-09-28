import { describe, expect, it, vi } from 'vitest';
import {
  BARMAN_CLOUD_PLUGIN_NAME,
  buildClusterManifest,
  collectParameters,
  defaultFormState,
  deriveSummary,
  getValidationErrors,
  instanceCardSelection,
  KLIO_PLUGIN_NAME,
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
