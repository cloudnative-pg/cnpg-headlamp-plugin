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
const error = (label: string, description: string): StatusInfo => ({
  severity: 'error',
  label,
  description,
});

/** A phase's severity and short chip/icon label, without a description — see `clusterPhaseStatus`
 * for why the description comes from `status.phaseReason` instead of being hardcoded here. */
interface PhaseInfo {
  severity: Severity;
  label: string;
}

/** Known `Cluster.status.phase` values (CNPG api/v1/cluster_types.go) → severity, label. */
const CLUSTER_PHASES: Record<string, PhaseInfo> = {
  'Cluster in healthy state': { severity: 'success', label: 'Healthy' },
  'Setting up primary': { severity: 'info', label: 'Starting' },
  'Creating a new replica': { severity: 'info', label: 'Adding replica' },
  'Switchover in progress': { severity: 'info', label: 'Switching over' },
  'Promoting to primary cluster': { severity: 'info', label: 'Promoting' },
  'Applying configuration': { severity: 'info', label: 'Applying config' },
  'Upgrading cluster': { severity: 'info', label: 'Upgrading' },
  'Online upgrade in progress': { severity: 'info', label: 'Upgrading' },
  'Upgrading Postgres major version': { severity: 'info', label: 'Major upgrade' },
  'Primary instance is being restarted in-place': { severity: 'info', label: 'Restarting primary' },
  'Waiting for the instances to become active': {
    severity: 'info',
    label: 'Waiting for instances',
  },
  'Failing over': { severity: 'warning', label: 'Failing over' },
  'Primary instance is being restarted without a switchover': {
    severity: 'warning',
    label: 'Restarting (no switchover)',
  },
  'Cluster upgrade delayed': { severity: 'warning', label: 'Upgrade delayed' },
  'Waiting for user action': { severity: 'warning', label: 'Action required' },
  'Cluster cannot proceed to reconciliation due to an unknown plugin being required': {
    severity: 'error',
    label: 'Plugin missing',
  },
  'Cluster cannot proceed to reconciliation due to an error while interacting with plugins': {
    severity: 'error',
    label: 'Plugin error',
  },
  'Cluster has incomplete or invalid image catalog': {
    severity: 'error',
    label: 'Image catalog error',
  },
  'Cluster cannot execute instance online upgrade due to missing architecture binary': {
    severity: 'error',
    label: 'Online upgrade blocked',
  },
  'Unable to create required cluster objects': { severity: 'error', label: "Can't create objects" },
  'Invalid cluster definition': { severity: 'error', label: 'Invalid definition' },
  'Cluster is unrecoverable and needs manual intervention': {
    severity: 'error',
    label: 'Unrecoverable',
  },
};

/**
 * Status of the cluster itself, derived from `status.phase` and `status.phaseReason` — backups
 * are reported separately (see `clusterBackupStatus`).
 *
 * The description is always `phaseReason`, not a hardcoded sentence per phase: the operator sets
 * `phaseReason` itself on every `RegisterPhase` call (CNPG's internal/controller/cluster_status.go),
 * with the actual, instance-specific detail (an error message, a pod name, "Requested by the
 * user", ...) — a per-phase static sentence here could only ever restate the phase name/label, so
 * it added no information while still needing to be kept in sync with CNPG's phase strings by hand.
 */
export function clusterPhaseStatus(
  phase: string | undefined,
  phaseReason?: string,
  hibernated = false
): StatusInfo {
  if (hibernated) {
    return {
      severity: 'neutral',
      label: 'Hibernated',
      description: 'Instance pods deleted, storage retained — rehydrate to resume',
    };
  }
  const known = phase ? CLUSTER_PHASES[phase] : undefined;
  return {
    severity: known?.severity ?? 'neutral',
    label: known?.label ?? phase ?? 'Unknown',
    description: phaseReason || phase || 'The operator has not reported a phase yet.',
  };
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
 * disk, so it is an error on its own.
 *
 * `LastBackupSucceeded` is deliberately *not* used to decide the error severity: the operator
 * flips it to `False` every time a new backup starts (see `BackupStartingCondition` in CNPG's
 * api/v1/cluster_conditions.go) and only flips it back once that backup finishes, so it reads
 * `False` for the whole, routine duration of every backup run — not just on actual failure.
 * Treating that as an error would flag every in-progress backup as a cluster-wide problem.
 *
 * Unlike `LastBackupSucceeded`, `ContinuousArchiving` is reported as-is: a brief `False` window
 * during every switchover/failover handoff (CNPG's
 * pkg/management/postgres/archiver/archiver.go:133-149 — the pod that isn't `currentPrimary`
 * refuses to archive) is genuinely true in that moment, so it is surfaced rather than hidden; see
 * the "WAL archiving" vs. "Backups" labeling this return value drives, which is what keeps that
 * brief, expected blip from reading as "your backups are broken".
 */
export function clusterBackupStatus(
  archiving: BackupCondition | undefined,
  lastBackup: BackupCondition | undefined
): StatusInfo | undefined {
  const archivingFailing = archiving !== undefined && parseBool(archiving.status) !== true;

  if (archivingFailing) {
    return {
      severity: 'error',
      label: 'WAL archiving failing',
      description: `WAL archiving is failing, so point-in-time recovery may be unavailable${
        archiving?.message ? ` (${archiving.message})` : ''
      }.`,
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
