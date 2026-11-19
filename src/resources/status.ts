/**
 * Status → severity mappings, kept free of any `@kinvolk/headlamp-plugin` import on purpose.
 *
 * Resource classes import `KubeObject` from `@kinvolk/headlamp-plugin/lib/k8s/cluster`, a path the
 * build resolves to a Headlamp runtime global rather than to a real file on disk (the actual module
 * sits at `lib/lib/k8s/...`). That works at build time but cannot be resolved by vitest, so nothing
 * that imports a resource class can be unit-tested. Keeping these mappings here — plain values in,
 * plain values out — makes the triage logic testable, and matches the "one status→severity mapping
 * per CRD, reused by list and detail" convention.
 */

/** Severity values accepted by CommonComponents' `StatusLabel`. */
export type StatusSeverity = 'success' | 'error' | 'warning' | '';

/**
 * Mirrors Go's strconv.ParseBool, which is how CNPG itself parses boolean-like strings
 * (e.g. the `cnpg.io/hibernation` status condition's `"True"`/`"False"`): accepts 1, t, T,
 * TRUE, true, True as true and 0, f, F, FALSE, false, False as false. Returns undefined for
 * anything else (including absent), so callers can distinguish "explicitly false" from "no
 * value reported". Notably, CNPG's `on`/`off` annotation values are *not* ParseBool values —
 * they must never be passed here.
 */
export function parseBool(value: string | undefined): boolean | undefined {
  switch (value) {
    case '1':
    case 't':
    case 'T':
    case 'TRUE':
    case 'true':
    case 'True':
      return true;
    case '0':
    case 'f':
    case 'F':
    case 'FALSE':
    case 'false':
    case 'False':
      return false;
    default:
      return undefined;
  }
}

/**
 * The declarative CRDs (Database, DatabaseRole, Publication, Subscription) all report progress the
 * same way: a tri-state `status.applied` plus a `status.message` explaining a failure.
 */
export function appliedSeverity(applied: boolean | undefined): StatusSeverity {
  if (applied === true) {
    return 'success';
  }
  if (applied === false) {
    return 'error';
  }
  return '';
}

/** A tag counts as a release version when it is `v`-prefixed (e.g. "v0.15.0") or looks like a
 * CNPG-style numeric version (e.g. "1.30.1-ubi9-catalog"). Anything else ("latest", "main",
 * "devel", …) is a development build. */
const VERSION_TAG_PATTERN = /^v?\d+(\.\d+)*([-.+].*)?$/;

/** Display-ready version for a container image reference.
 *
 * Returns the tag normalized to a single leading `v` (so both "1.30.0" and "v0.15.0" display as
 * "v1.30.0" / "v0.15.0"), `"devel"` when the image carries no parseable release tag (e.g.
 * "registry.dev:5000/cnpg-i-spiffe:latest"), and `"-"` when there is no image at all. */
export function getImageVersion(image: string | undefined): string {
  if (!image) {
    return '-';
  }
  // Strip any digest ("repo:tag@sha256:…" or "repo@sha256:…") — the tag, if present, is before it.
  const withoutDigest = image.split('@')[0] ?? image;
  // The tag separator is a colon *after* the last slash; a colon before it belongs to a registry
  // port (e.g. "registry.dev:5000/…").
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  if (lastColon <= lastSlash) {
    return 'devel';
  }
  const tag = withoutDigest.slice(lastColon + 1);
  if (!tag || !VERSION_TAG_PATTERN.test(tag)) {
    return 'devel';
  }
  return tag.startsWith('v') ? tag : `v${tag}`;
}

/**
 * Capabilities we can truthfully claim for well-known CNPG-i plugins. A plugin's actual
 * capabilities are only exposed over its own gRPC interface, which this UI cannot query — so for
 * any plugin ID absent from this map the caller must fall back to showing discoverable data
 * (Service name, selector, pods) rather than inventing capabilities.
 */
export const KNOWN_PLUGIN_CAPABILITIES: Record<string, string[]> = {
  'barman-cloud.cloudnative-pg.io': ['Backup', 'WAL archiving', 'Restore'],
  'klio.cnpg.io': ['Backup', 'WAL archiving', 'Restore'],
};

/** Display names for well-known CNPG-i plugin IDs (the `cnpg.io/pluginName` label value). */
const KNOWN_PLUGIN_NAMES: Record<string, string> = {
  'barman-cloud.cloudnative-pg.io': 'Barman Cloud',
  'klio.cnpg.io': 'Klio',
};

/** Turns a `cnpg.io/pluginName` label value into a human-readable title, e.g.
 * "barman-cloud.cloudnative-pg.io" → "Barman Cloud". Unknown IDs fall back to prettifying the
 * part before the first dot ("my-plugin.example.io" → "My Plugin"). */
export function humanizePluginName(pluginId: string): string {
  const known = KNOWN_PLUGIN_NAMES[pluginId];
  if (known) {
    return known;
  }
  const prefix = pluginId.split('.')[0] ?? pluginId;
  const words = prefix
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(' ') : pluginId;
}

/**
 * Four-level severity used by the cluster status chip and the backup status icon. `info` (blue)
 * is for expected, transient work (a planned switchover, an upgrade) — it must never read as a
 * problem. `neutral` is for states with nothing to judge (hibernated, unknown phase).
 */
export type Severity = 'success' | 'info' | 'warning' | 'error' | 'neutral';

export interface StatusInfo {
  severity: Severity;
  /** Short chip/icon label. */
  label: string;
  /** Human-readable explanation, shown in a tooltip. */
  description: string;
}

const info = (label: string, description: string): StatusInfo => ({
  severity: 'info',
  label,
  description,
});
const warning = (label: string, description: string): StatusInfo => ({
  severity: 'warning',
  label,
  description,
});
const error = (label: string, description: string): StatusInfo => ({
  severity: 'error',
  label,
  description,
});

/** Known `Cluster.status.phase` values (CNPG api/v1/cluster_types.go) → severity, label, reason. */
const CLUSTER_PHASES: Record<string, StatusInfo> = {
  'Cluster in healthy state': {
    severity: 'success',
    label: 'Healthy',
    description: 'The cluster is fully reconciled and healthy.',
  },
  'Setting up primary': info('Starting', 'The first primary instance is being set up.'),
  'Creating a new replica': info('Adding replica', 'A new replica instance is being created.'),
  'Switchover in progress': info(
    'Switching over',
    'The primary role is being moved to another instance.'
  ),
  'Promoting to primary cluster': info(
    'Promoting',
    'This replica cluster is being promoted to a primary cluster.'
  ),
  'Applying configuration': info(
    'Applying config',
    'A configuration change was detected and is being applied.'
  ),
  'Upgrading cluster': info('Upgrading', 'The cluster is being upgraded.'),
  'Online upgrade in progress': info(
    'Upgrading',
    'The instance manager is being upgraded in place.'
  ),
  'Upgrading Postgres major version': info(
    'Major upgrade',
    'A PostgreSQL major version upgrade is in progress.'
  ),
  'Primary instance is being restarted in-place': info(
    'Restarting primary',
    'The primary instance is being restarted in place.'
  ),
  'Waiting for the instances to become active': info(
    'Waiting for instances',
    'Waiting for instance pods to become active.'
  ),
  'Failing over': warning(
    'Failing over',
    'The primary is unavailable and the operator is promoting another instance.'
  ),
  'Primary instance is being restarted without a switchover': warning(
    'Restarting (no switchover)',
    'The primary is being restarted without a switchover, so there is a short downtime.'
  ),
  'Cluster upgrade delayed': warning(
    'Upgrade delayed',
    'The cluster needs an upgrade, but the operator configuration is delaying it.'
  ),
  'Waiting for user action': warning(
    'Action required',
    'The operator is waiting for an action from you to proceed.'
  ),
  'Cluster cannot proceed to reconciliation due to an unknown plugin being required': error(
    'Plugin missing',
    'A required CNPG-i plugin is not loaded yet, so the cluster cannot be reconciled.'
  ),
  'Cluster cannot proceed to reconciliation due to an error while interacting with plugins': error(
    'Plugin error',
    'The operator failed while interacting with a CNPG-i plugin, so the cluster cannot be reconciled.'
  ),
  'Cluster has incomplete or invalid image catalog': error(
    'Image catalog error',
    'The image catalog is invalid or incomplete, so no image could be selected.'
  ),
  'Cluster cannot execute instance online upgrade due to missing architecture binary': error(
    'Online upgrade blocked',
    'The instance manager binary for this architecture is missing, so the online upgrade cannot run.'
  ),
  'Unable to create required cluster objects': error(
    "Can't create objects",
    'The operator is unable to create the Kubernetes resources the cluster needs.'
  ),
  'Invalid cluster definition': error(
    'Invalid definition',
    'The cluster definition is invalid. Check the spec and the operator logs.'
  ),
  'Cluster is unrecoverable and needs manual intervention': error(
    'Unrecoverable',
    'The cluster cannot recover on its own and needs manual intervention.'
  ),
};

/**
 * Status of the cluster itself, derived from `status.phase` only — backups are reported
 * separately (see `clusterBackupStatus`).
 */
export function clusterPhaseStatus(phase: string | undefined, hibernated = false): StatusInfo {
  if (hibernated) {
    return {
      severity: 'neutral',
      label: 'Hibernated',
      description: 'Instance pods deleted, storage retained — rehydrate to resume',
    };
  }
  const known = phase ? CLUSTER_PHASES[phase] : undefined;
  const base: StatusInfo = known ?? {
    severity: 'neutral',
    label: phase ? phase : 'Unknown',
    description: phase
      ? `Phase reported by the operator: ${phase}.`
      : 'The operator has not reported a phase yet.',
  };
  return base;
}

/** The slice of a Cluster condition `clusterBackupStatus` needs. */
export interface BackupCondition {
  status?: string;
  message?: string;
}

/**
 * Backup health of a cluster, from its `ContinuousArchiving` and `LastBackupSucceeded` conditions.
 * Returns `undefined` when the cluster reports neither (no backups configured) so callers can
 * render nothing. Failing WAL archiving breaks point-in-time recovery and can fill the primary's
 * disk, so it is an error just like a failed backup.
 */
export function clusterBackupStatus(
  archiving: BackupCondition | undefined,
  lastBackup: BackupCondition | undefined
): StatusInfo | undefined {
  const archivingFailing = archiving !== undefined && parseBool(archiving.status) !== true;
  const backupFailed = lastBackup !== undefined && parseBool(lastBackup.status) !== true;

  if (archivingFailing || backupFailed) {
    const reasons: string[] = [];
    if (archivingFailing) {
      reasons.push(
        `WAL archiving is failing, so point-in-time recovery may be unavailable${
          archiving?.message ? ` (${archiving.message})` : ''
        }.`
      );
    }
    if (backupFailed) {
      reasons.push(
        `The last backup failed${lastBackup?.message ? ` (${lastBackup.message})` : ''}.`
      );
    }
    return {
      severity: 'error',
      label: archivingFailing ? 'WAL archiving failing' : 'Backup failed',
      description: reasons.join(' '),
    };
  }
  if (archiving === undefined && lastBackup === undefined) {
    return undefined;
  }
  return {
    severity: 'success',
    label: 'Backups OK',
    description:
      archiving !== undefined && lastBackup !== undefined
        ? 'WAL archiving is working and the last backup completed.'
        : archiving !== undefined
        ? 'WAL archiving is working.'
        : 'The last backup completed.',
  };
}

/** Known `Backup.status.phase` values (CNPG api/v1/backup_types.go) → severity, label, reason. */
const BACKUP_PHASES: Record<string, StatusInfo> = {
  completed: { severity: 'success', label: 'Completed', description: 'The backup completed.' },
  pending: info('Pending', 'The backup is waiting to be started.'),
  started: info('Started', 'The backup has started.'),
  running: info('Running', 'The backup is running.'),
  finalizing: info(
    'Finalizing',
    'A consistent backup was taken; waiting for it to be ready to restore from.'
  ),
  failed: error('Failed', 'The backup failed.'),
  walArchivingFailing: error(
    'WAL archiving failing',
    'WAL archiving is not working, so this backup cannot be used for point-in-time recovery.'
  ),
  'invalid backup definition': error('Invalid definition', 'The backup definition is invalid.'),
};

/** Status of a single Backup, from `status.phase`; `errorMessage` is `status.error`, if any. */
export function backupPhaseStatus(phase: string | undefined, errorMessage?: string): StatusInfo {
  const base: StatusInfo = (phase ? BACKUP_PHASES[phase] : undefined) ?? {
    severity: 'neutral',
    label: phase ?? '-',
    description: phase
      ? `Phase reported by the operator: ${phase}.`
      : 'The operator has not reported a phase yet.',
  };
  return errorMessage ? { ...base, description: `${base.description} ${errorMessage}` } : base;
}
