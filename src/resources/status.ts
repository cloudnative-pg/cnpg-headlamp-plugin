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
