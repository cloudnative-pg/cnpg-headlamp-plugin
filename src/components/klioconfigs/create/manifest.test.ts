import { describe, expect, it } from 'vitest';
import {
  buildKlioConfigManifest,
  defaultKlioConfigFormState,
  deriveKlioConfigSummary,
  getKlioConfigValidationErrors,
} from './types';

function baseState() {
  return {
    ...defaultKlioConfigFormState(),
    namespace: 'default',
    name: 'client-config-example-plugin',
    serverAddress: 'server-sample.default',
    clientSecretName: 'client-sample-tls',
    serverSecretName: 'server-sample-tls',
    clusterName: 'cluster-example',
  };
}

describe('buildKlioConfigManifest', () => {
  it('builds a minimal standard config', () => {
    expect(buildKlioConfigManifest(baseState())).toMatchObject({
      apiVersion: 'klio.cnpg.io/v1alpha1',
      kind: 'PluginConfiguration',
      metadata: { name: 'client-config-example-plugin', namespace: 'default' },
      spec: {
        serverAddress: 'server-sample.default',
        clusterName: 'cluster-example',
        mode: 'standard',
      },
    });
    expect(buildKlioConfigManifest(baseState()).spec).not.toHaveProperty('tier1');
    expect(buildKlioConfigManifest(baseState()).spec).not.toHaveProperty('tier2');
  });

  it('emits tier1/tier2 retention and flags when set', () => {
    const manifest = buildKlioConfigManifest({
      ...baseState(),
      tier1Retention: {
        keepLatest: '5',
        keepHourly: '',
        keepDaily: '7',
        keepWeekly: '',
        keepMonthly: '',
        keepAnnual: '',
      },
      tier2EnableBackup: true,
      tier2EnableRecovery: true,
      tier2Retention: {
        keepLatest: '',
        keepHourly: '',
        keepDaily: '30',
        keepWeekly: '',
        keepMonthly: '',
        keepAnnual: '',
      },
    });
    expect(manifest.spec.tier1).toEqual({ retention: { keepLatest: 5, keepDaily: 7 } });
    expect(manifest.spec.tier2).toEqual({
      enableBackup: true,
      enableRecovery: true,
      retention: { keepDaily: 30 },
    });
  });

  it('forces recovery-only tier2 without tier1 for read-only mode', () => {
    const manifest = buildKlioConfigManifest({ ...baseState(), mode: 'read-only' });
    expect(manifest.spec).not.toHaveProperty('tier1');
    expect(manifest.spec.tier2).toEqual({ enableRecovery: true });
  });

  it('emits walPrefetch and pprof when set', () => {
    const manifest = buildKlioConfigManifest({
      ...baseState(),
      walPrefetchCount: '8',
      walPrefetchMaxConcurrent: '16',
      pprof: true,
    });
    expect(manifest.spec.walPrefetch).toEqual({ count: 8, maxConcurrentDownloads: 16 });
    expect(manifest.spec.pprof).toBe(true);
  });
});

describe('getKlioConfigValidationErrors', () => {
  it('requires identity fields and secrets', () => {
    expect(getKlioConfigValidationErrors(defaultKlioConfigFormState())).toContain(
      'Namespace is required.'
    );
    expect(getKlioConfigValidationErrors(baseState())).toEqual([]);
  });

  it('rejects tier1 and tier2 backups in read-only mode', () => {
    const errors = getKlioConfigValidationErrors({
      ...baseState(),
      mode: 'read-only',
      tier1Retention: {
        keepLatest: '5',
        keepHourly: '',
        keepDaily: '',
        keepWeekly: '',
        keepMonthly: '',
        keepAnnual: '',
      },
      tier2EnableBackup: true,
    });
    expect(errors).toContain('Tier 1 is not allowed in read-only mode.');
    expect(errors).toContain('Tier 2 backups are not allowed in read-only mode.');
  });

  it('rejects non-numeric retention and prefetch values', () => {
    const errors = getKlioConfigValidationErrors({
      ...baseState(),
      tier2Retention: {
        keepLatest: '',
        keepHourly: '',
        keepDaily: 'soon',
        keepWeekly: '',
        keepMonthly: '',
        keepAnnual: '',
      },
      walPrefetchCount: '-1',
    });
    expect(errors).toContain('Tier 2 retention rules must be whole numbers.');
    expect(errors).toContain('WAL prefetch count must be a whole number.');
  });
});

describe('deriveKlioConfigSummary', () => {
  it('summarizes tier2 flags', () => {
    expect(deriveKlioConfigSummary(baseState()).tier2).toBe('Disabled');
    expect(
      deriveKlioConfigSummary({ ...baseState(), mode: 'read-only' }).tier2
    ).toBe('Recovery');
  });
});
