import { describe, expect, it } from 'vitest';
import {
  buildKlioServerManifest,
  defaultKlioServerFormState,
  deriveKlioServerSummary,
  getKlioServerValidationErrors,
} from './types';

function baseState() {
  return {
    ...defaultKlioServerFormState(),
    namespace: 'default',
    name: 'server-sample',
    image: 'ghcr.io/cloudnative-pg/klio:v0.0.20',
    tlsSecretName: 'server-sample-tls',
    caSecretName: 'server-sample-ca',
    tier1EncryptionKey: { secretName: 'server-sample-encryption', path: 'encryption-key' },
    tier1Identity: { secretName: 'server-sample-encryption', path: 'secret-key' },
  };
}

describe('buildKlioServerManifest', () => {
  it('builds a standard server with tier1 and no tier2 by default', () => {
    const manifest = buildKlioServerManifest(baseState());
    expect(manifest).toMatchObject({
      apiVersion: 'klio.cnpg.io/v1alpha1',
      kind: 'Server',
      metadata: { name: 'server-sample', namespace: 'default' },
      spec: {
        mode: 'standard',
        tier1: {
          encryptionKeyFile: {
            fileReference: {
              path: 'encryption-key',
              volume: { secret: { secretName: 'server-sample-encryption' } },
            },
          },
        },
      },
    });
    expect(manifest.spec).not.toHaveProperty('tier2');
  });

  it('omits tier1 and forces tier2 for read-only mode', () => {
    const manifest = buildKlioServerManifest({
      ...baseState(),
      mode: 'read-only',
      tier2EncryptionKey: { secretName: 'enc', path: 'encryption-key' },
      tier2Identity: { secretName: 'enc', path: 'secret-key' },
      s3: {
        ...baseState().s3,
        bucketName: 'klio-bucket',
        useCredentials: false,
      },
    });
    expect(manifest.spec).not.toHaveProperty('tier1');
    expect(manifest.spec.tier2.s3).toEqual({ bucketName: 'klio-bucket' });
  });

  it('omits S3 credentials on the IAM-role path', () => {
    const manifest = buildKlioServerManifest({
      ...baseState(),
      tier2Enabled: true,
      tier2EncryptionKey: { secretName: 'enc', path: 'encryption-key' },
      tier2Identity: { secretName: 'enc', path: 'secret-key' },
      s3: {
        ...baseState().s3,
        bucketName: 'klio-bucket',
        endpoint: 'https://rustfs:9000',
        useCredentials: false,
      },
    });
    expect(manifest.spec.tier2.s3).toMatchObject({
      bucketName: 'klio-bucket',
      endpoint: 'https://rustfs:9000',
    });
    expect(manifest.spec.tier2.s3).not.toHaveProperty('accessKeyId');
    expect(manifest.spec.tier2.s3).not.toHaveProperty('secretAccessKey');
  });

  it('includes S3 credentials and custom CA when set', () => {
    const manifest = buildKlioServerManifest({
      ...baseState(),
      tier2Enabled: true,
      tier2EncryptionKey: { secretName: 'enc', path: 'encryption-key' },
      tier2Identity: { secretName: 'enc', path: 'secret-key' },
      s3: {
        bucketName: 'klio-bucket',
        prefix: 'klio',
        endpoint: 'https://rustfs:9000',
        region: 'us-east-1',
        useCredentials: true,
        accessKeyId: { name: 'rustfs-secret', key: 'RUSTFS_ACCESS_KEY' },
        secretAccessKey: { name: 'rustfs-secret', key: 'RUSTFS_SECRET_KEY' },
        useCustomCa: true,
        customCaBundle: { name: 'rustfs-tls', key: 'tls.crt' },
      },
    });
    expect(manifest.spec.tier2.s3).toEqual({
      bucketName: 'klio-bucket',
      prefix: 'klio',
      endpoint: 'https://rustfs:9000',
      region: 'us-east-1',
      accessKeyId: { name: 'rustfs-secret', key: 'RUSTFS_ACCESS_KEY' },
      secretAccessKey: { name: 'rustfs-secret', key: 'RUSTFS_SECRET_KEY' },
      customCaBundle: { name: 'rustfs-tls', key: 'tls.crt' },
    });
  });
});

describe('getKlioServerValidationErrors', () => {
  it('requires identity fields, image, secrets and tier1 key files', () => {
    expect(getKlioServerValidationErrors(defaultKlioServerFormState())).toContain(
      'Namespace is required.'
    );
    expect(getKlioServerValidationErrors(baseState())).toEqual([]);
  });

  it('requires tier2 key files and bucket when tier2 is enabled', () => {
    const errors = getKlioServerValidationErrors({ ...baseState(), tier2Enabled: true });
    expect(errors).toContain('Tier 2 encryption key and identity files are required.');
    expect(errors).toContain('Tier 2 bucket name is required.');
  });
});

describe('deriveKlioServerSummary', () => {
  it('summarizes tiers for a standard server without tier2', () => {
    expect(deriveKlioServerSummary(baseState())).toMatchObject({
      mode: 'standard',
      tier1: 'Local PVC',
      tier2: 'Disabled',
    });
  });
});
