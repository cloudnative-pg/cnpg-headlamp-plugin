import { describe, expect, it } from 'vitest';
import { certManagerListOptions, isCertManagerDeployment } from './InstallGuide';

describe('certManagerListOptions', () => {
  it('lists controller Deployments cluster-wide when no namespace is configured', () => {
    expect(certManagerListOptions(null)).toEqual({
      labelSelector: 'app.kubernetes.io/component=controller',
    });
  });

  it('scopes to the configured namespace', () => {
    expect(certManagerListOptions('certmanager')).toEqual({ namespace: 'certmanager' });
  });
});

describe('isCertManagerDeployment', () => {
  it('matches the default name label', () => {
    expect(
      isCertManagerDeployment({
        metadata: { labels: { 'app.kubernetes.io/name': 'cert-manager' } },
      })
    ).toBe(true);
  });

  it('matches by controller image when nameOverride changed the name label', () => {
    expect(
      isCertManagerDeployment({
        metadata: { labels: { 'app.kubernetes.io/name': 'cm' } },
        spec: {
          template: {
            spec: { containers: [{ image: 'quay.io/jetstack/cert-manager-controller:v1.21.3' }] },
          },
        },
      })
    ).toBe(true);
  });

  it('rejects unrelated controllers', () => {
    expect(
      isCertManagerDeployment({
        metadata: { labels: { 'app.kubernetes.io/name': 'other' } },
        spec: { template: { spec: { containers: [{ image: 'foo/bar:1' }] } } },
      })
    ).toBe(false);
  });
});
