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

/** Phases CNPG reports on `Backup.status.phase`. */
export function backupPhaseSeverity(phase: string | undefined): StatusSeverity {
  switch (phase) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'walArchivingFailing':
    case 'invalid backup definition':
      return 'error';
    case 'pending':
    case 'started':
    case 'running':
    case 'finalizing':
      return 'warning';
    default:
      return '';
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

/** The tag (or digest) portion of a container image reference, e.g. "1.24.1" from
 * "ghcr.io/cloudnative-pg/cloudnative-pg:1.24.1". Falls back to the full image string when no
 * tag/digest can be identified, rather than guessing. */
export function getImageVersion(image: string | undefined): string {
  if (!image) {
    return '-';
  }
  const lastSegment = image.split('/').pop() ?? image;
  const [, tag] = lastSegment.split(':');
  return tag ?? image;
}

/**
 * Capabilities we can truthfully claim for well-known CNPG-i plugins. A plugin's actual
 * capabilities are only exposed over its own gRPC interface, which this UI cannot query — so for
 * any plugin ID absent from this map the caller must fall back to showing discoverable data
 * (Service name, selector, pods) rather than inventing capabilities.
 */
export const KNOWN_PLUGIN_CAPABILITIES: Record<string, string[]> = {
  'barman-cloud.cloudnative-pg.io': ['Backup', 'WAL archiving', 'Restore'],
};

/** Display names for well-known CNPG-i plugin IDs (the `cnpg.io/pluginName` label value). */
const KNOWN_PLUGIN_NAMES: Record<string, string> = {
  'barman-cloud.cloudnative-pg.io': 'Barman Cloud',
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
