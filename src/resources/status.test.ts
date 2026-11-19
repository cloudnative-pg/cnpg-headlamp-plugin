import { describe, expect, it } from 'vitest';
import {
  appliedSeverity,
  backupPhaseStatus,
  clusterBackupStatus,
  clusterPhaseStatus,
  getImageVersion,
  humanizePluginName,
  KNOWN_PLUGIN_CAPABILITIES,
  parseBool,
} from './status';

describe('parseBool', () => {
  // Mirrors Go's strconv.ParseBool exactly — every accepted spelling must round-trip, since
  // CNPG writes e.g. "True" into status conditions and this is what parses them back out.
  it.each(['1', 't', 'T', 'TRUE', 'true', 'True'])('parses %s as true', value => {
    expect(parseBool(value)).toBe(true);
  });

  it.each(['0', 'f', 'F', 'FALSE', 'false', 'False'])('parses %s as false', value => {
    expect(parseBool(value)).toBe(false);
  });

  // CNPG's hibernation annotation uses `on`/`off`, which strconv.ParseBool rejects — passing
  // those here must not read as either boolean, otherwise the annotation and the status
  // condition (`"True"`/`"False"`) would be conflated.
  it.each([undefined, '', 'on', 'off', 'ON', 'OFF', 'yes', 'no', '2', ' true'])(
    'returns undefined for %s',
    value => {
      expect(parseBool(value)).toBeUndefined();
    }
  );
});

describe('backupPhaseStatus', () => {
  it('marks a completed backup as success', () => {
    expect(backupPhaseStatus('completed').severity).toBe('success');
  });

  // `walArchivingFailing` in particular is easy to miss because the Backup object itself is
  // otherwise unremarkable, so it must read as an error.
  it.each(['failed', 'walArchivingFailing', 'invalid backup definition'])(
    'marks %s as an error',
    phase => {
      expect(backupPhaseStatus(phase).severity).toBe('error');
    }
  );

  it.each(['pending', 'started', 'running', 'finalizing'])('marks %s as in progress', phase => {
    expect(backupPhaseStatus(phase).severity).toBe('info');
  });

  // CNPG is free to add phases we do not know about — neither those nor a Backup that has no
  // phase yet should render as success or error.
  it('falls back to neutral for an unknown or absent phase', () => {
    expect(backupPhaseStatus(undefined)).toMatchObject({ severity: 'neutral', label: '-' });
    expect(backupPhaseStatus('some-future-cnpg-phase').severity).toBe('neutral');
  });

  it('appends status.error to the description', () => {
    expect(backupPhaseStatus('failed', 'bucket not found').description).toContain(
      'bucket not found'
    );
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
    expect(getImageVersion('ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0@sha256:abc123')).toBe(
      'v1.30.0'
    );
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

describe('clusterPhaseStatus', () => {
  it('reports the healthy phase as success', () => {
    expect(clusterPhaseStatus('Cluster in healthy state').severity).toBe('success');
  });

  // Planned/transient work must read as "in progress", never as a problem.
  it.each([
    'Switchover in progress',
    'Upgrading cluster',
    'Upgrading Postgres major version',
    'Applying configuration',
    'Creating a new replica',
  ])('reports %s as info', phase => {
    expect(clusterPhaseStatus(phase).severity).toBe('info');
  });

  it.each(['Failing over', 'Waiting for user action', 'Cluster upgrade delayed'])(
    'reports %s as warning',
    phase => {
      expect(clusterPhaseStatus(phase).severity).toBe('warning');
    }
  );

  it.each([
    'Invalid cluster definition',
    'Cluster is unrecoverable and needs manual intervention',
    'Unable to create required cluster objects',
    'Cluster has incomplete or invalid image catalog',
  ])('reports %s as error', phase => {
    expect(clusterPhaseStatus(phase).severity).toBe('error');
  });

  it('is neutral for hibernated, unknown and missing phases', () => {
    expect(clusterPhaseStatus('Cluster in healthy state', true)).toMatchObject({
      severity: 'neutral',
      label: 'Hibernated',
    });
    expect(clusterPhaseStatus('Some future phase')).toMatchObject({
      severity: 'neutral',
      label: 'Some future phase',
    });
    expect(clusterPhaseStatus(undefined)).toMatchObject({ severity: 'neutral', label: 'Unknown' });
  });
});

describe('clusterBackupStatus', () => {
  it('is undefined when no backup condition is reported', () => {
    expect(clusterBackupStatus(undefined, undefined)).toBeUndefined();
  });

  it('is success when archiving works and the last backup succeeded', () => {
    expect(clusterBackupStatus({ status: 'True' }, { status: 'True' })?.severity).toBe('success');
    expect(clusterBackupStatus({ status: 'True' }, undefined)?.severity).toBe('success');
  });

  it('is an error with the reason when the last backup failed', () => {
    const result = clusterBackupStatus({ status: 'True' }, { status: 'False', message: 'boom' });
    expect(result).toMatchObject({ severity: 'error', label: 'Backup failed' });
    expect(result?.description).toContain('boom');
  });

  it('is an error when WAL archiving is failing', () => {
    const result = clusterBackupStatus({ status: 'False' }, { status: 'True' });
    expect(result).toMatchObject({ severity: 'error', label: 'WAL archiving failing' });
  });
});
