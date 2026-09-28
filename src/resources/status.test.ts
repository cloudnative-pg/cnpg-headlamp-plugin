import { describe, expect, it } from 'vitest';
import {
  appliedSeverity,
  backupPhaseSeverity,
  getImageVersion,
  humanizePluginName,
  KNOWN_PLUGIN_CAPABILITIES,
} from './status';

describe('backupPhaseSeverity', () => {
  it('marks a completed backup as success', () => {
    expect(backupPhaseSeverity('completed')).toBe('success');
  });

  // These three are the phases an operator needs to notice; `walArchivingFailing` in particular is
  // easy to miss because the Backup object itself is otherwise unremarkable.
  it.each(['failed', 'walArchivingFailing', 'invalid backup definition'])(
    'marks %s as an error',
    phase => {
      expect(backupPhaseSeverity(phase)).toBe('error');
    }
  );

  it.each(['pending', 'started', 'running', 'finalizing'])('marks %s as in-progress', phase => {
    expect(backupPhaseSeverity(phase)).toBe('warning');
  });

  // A Backup has no status.phase between creation and the operator's first reconcile, and CNPG is
  // free to add phases we do not know about — neither should render as success or error.
  it('falls back to neutral for an unknown or absent phase', () => {
    expect(backupPhaseSeverity(undefined)).toBe('');
    expect(backupPhaseSeverity('some-future-cnpg-phase')).toBe('');
  });
});

describe('appliedSeverity', () => {
  it('distinguishes applied from not-applied', () => {
    expect(appliedSeverity(true)).toBe('success');
    expect(appliedSeverity(false)).toBe('error');
  });

  // status.applied is genuinely tri-state: absent until the operator reconciles the object. That
  // must not be conflated with `false`, which means the operator tried and failed.
  it('treats an unreconciled object as neutral, not failed', () => {
    expect(appliedSeverity(undefined)).toBe('');
  });
});

describe('getImageVersion', () => {
  it('extracts the tag from a fully-qualified image, normalizing to a single leading v', () => {
    expect(getImageVersion('ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0')).toBe('v1.30.0');
    expect(getImageVersion('ghcr.io/cloudnative-pg/cloudnative-pg:1.30.1-ubi9-catalog')).toBe(
      'v1.30.1-ubi9-catalog'
    );
    expect(getImageVersion('ghcr.io/cloudnative-pg/plugin-barman-cloud:v0.15.0')).toBe('v0.15.0');
  });

  it('falls back to a placeholder for a missing image', () => {
    expect(getImageVersion(undefined)).toBe('-');
  });

  it('reports devel for non-version tags, including registries with a port', () => {
    expect(getImageVersion('registry.dev:5000/cnpg-i-spiffe:latest')).toBe('devel');
    expect(getImageVersion('ghcr.io/cloudnative-pg/cloudnative-pg:main')).toBe('devel');
  });

  it('reports devel when there is no tag', () => {
    expect(getImageVersion('postgres')).toBe('devel');
  });

  it('ignores digests when extracting the tag', () => {
    expect(
      getImageVersion(
        'ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0@sha256:abc123'
      )
    ).toBe('v1.30.0');
    expect(getImageVersion('registry.dev:5000/cnpg-i-spiffe:latest@sha256:abc123')).toBe('devel');
  });
});

describe('humanizePluginName', () => {
  it('uses the display name of well-known plugins', () => {
    expect(humanizePluginName('barman-cloud.cloudnative-pg.io')).toBe('Barman Cloud');
  });

  it('prettifies unknown plugin IDs from the part before the first dot', () => {
    expect(humanizePluginName('my-plugin.example.io')).toBe('My Plugin');
  });

  it('documents capabilities only for plugins whose behavior is known', () => {
    expect(KNOWN_PLUGIN_CAPABILITIES['barman-cloud.cloudnative-pg.io']).toEqual([
      'Backup',
      'WAL archiving',
      'Restore',
    ]);
    expect(KNOWN_PLUGIN_CAPABILITIES['my-plugin.example.io']).toBeUndefined();
  });
});
