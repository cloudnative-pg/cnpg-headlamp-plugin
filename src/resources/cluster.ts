import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { parseBool } from './status';

/** A single entry in Cluster.status.conditions (standard metav1.Condition shape). */
export interface ClusterCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

interface SynchronousReplicaConfiguration {
  method: 'any' | 'first';
  number: number;
  dataDurability?: 'required' | 'preferred';
}

/** Per-instance data the operator already collected during its last reconciliation loop. */
export interface InstanceReportedState {
  isPrimary: boolean;
  timeLineID?: number;
  ip?: string;
}

/** Shared shape of spec.storage / spec.walStorage / tablespaces[].storage. */
export interface StorageConfiguration {
  size?: string;
  storageClass?: string;
  [otherProps: string]: any;
}

export interface TablespaceConfiguration {
  name: string;
  storage: StorageConfiguration;
  temporary?: boolean;
}

/** Same shape used at spec.plugins[] and spec.externalClusters[].plugin. */
export interface PluginConfiguration {
  name: string;
  enabled?: boolean;
  isWALArchiver?: boolean;
  parameters?: Record<string, string>;
}

export interface ExternalClusterConfiguration {
  name: string;
  plugin: PluginConfiguration;
}

/**
 * spec.imageCatalogRef — picks a PostgreSQL major version out of an (Cluster)ImageCatalog.
 * apiGroup is required by the CRD (rejected as invalid if omitted) despite kubectl explain not
 * marking it so — always 'postgresql.cnpg.io' in practice, since ImageCatalog/ClusterImageCatalog
 * are the only kinds this field can reference.
 */
export interface ImageCatalogRef {
  apiGroup: string;
  kind: 'ImageCatalog' | 'ClusterImageCatalog';
  name: string;
  major: number;
}

export interface CnpgCluster extends KubeObjectInterface {
  spec: {
    instances: number;
    minSyncReplicas?: number;
    maxSyncReplicas?: number;
    postgresql?: {
      synchronous?: SynchronousReplicaConfiguration;
      parameters?: Record<string, string>;
    };
    storage?: StorageConfiguration;
    walStorage?: StorageConfiguration;
    tablespaces?: TablespaceConfiguration[];
    backup?: {
      volumeSnapshot?: {
        className?: string;
        walClassName?: string;
        [otherProps: string]: any;
      };
      [otherProps: string]: any;
    };
    plugins?: PluginConfiguration[];
    bootstrap?: {
      recovery?: {
        source?: string;
        [otherProps: string]: any;
      };
      [otherProps: string]: any;
    };
    externalClusters?: ExternalClusterConfiguration[];
    imageName?: string;
    imageCatalogRef?: ImageCatalogRef;
    [otherProps: string]: any;
  };
  status?: {
    phase?: string;
    phaseReason?: string;
    currentPrimary?: string;
    targetPrimary?: string;
    currentPrimaryTimestamp?: string;
    instances?: number;
    readyInstances?: number;
    conditions?: ClusterCondition[];
    systemID?: string;
    image?: string;
    timelineID?: number;
    instancesReportedState?: Record<string, InstanceReportedState>;
    [otherProps: string]: any;
  };
}

/** Cluster.status.phase value CNPG uses when everything is reconciled and healthy. */
const PHASE_HEALTHY = 'Cluster in healthy state';

/**
 * Declarative hibernation annotation (see CNPG's `kubectl cnpg hibernate` command in
 * internal/cmd/plugin/hibernate/cmd.go): 'on' requests hibernation (all instance pods are
 * removed while PVCs are retained), 'off' (or absent) means the cluster should be running.
 * This is only the *request* — whether the cluster actually is hibernated is reported by the
 * operator via the `cnpg.io/hibernation` status condition (see HIBERNATION_CONDITION_TYPE).
 */
export const HIBERNATION_ANNOTATION = 'cnpg.io/hibernation';
const HIBERNATION_ON = 'on';

/** Type of the status condition the operator sets to report hibernation state. */
export const HIBERNATION_CONDITION_TYPE = 'cnpg.io/hibernation';

const CONDITION_CONTINUOUS_ARCHIVING = 'ContinuousArchiving';
const CONDITION_LAST_BACKUP_SUCCEEDED = 'LastBackupSucceeded';

export type ClusterHealth = 'success' | 'warning' | 'error';

export class Cluster extends KubeObject<CnpgCluster> {
  static kind = 'Cluster';
  static apiName = 'clusters';
  static apiVersion = 'postgresql.cnpg.io/v1';
  static isNamespaced = true;

  // Seeds the "Create" YAML editor with a minimal working example instead of an empty object.
  // The guided form is components/clusters/create/CreatePage.tsx — this is only a
  // fallback for anything that falls back to a raw-YAML create flow.
  static getBaseObject() {
    return {
      apiVersion: 'postgresql.cnpg.io/v1',
      kind: 'Cluster',
      metadata: {
        name: '',
      },
      spec: {
        instances: 3,
        storage: {
          size: '1Gi',
        },
        postgresql: {
          synchronous: {
            method: 'any',
            number: 1,
            dataDurability: 'required',
          },
        },
      },
    };
  }

  // Returning the raw path (rather than the 'CNPG Cluster' route name registered in
  // index.tsx) is deliberate: KubeObject.getDetailsLink() -> createRouteURL() falls back to a
  // path-based route lookup and correctly generates the link, whereas the name-based lookup was
  // observed to return an empty string here (breaking navigation) despite matching the
  // registered route name. This mirrors the same workaround the official cert-manager plugin
  // uses, at the cost of a harmless "[Deprecation] found by path instead of name" console warning.
  static get detailsRoute() {
    return '/cnpg/clusters/:namespace/:name';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status ?? {};
  }

  get phase(): string | undefined {
    return this.status.phase;
  }

  /**
   * True when the operator reports the cluster as hibernated via the `cnpg.io/hibernation`
   * status condition (`status: "True"`). This mirrors CNPG's own `isHibernated()` in
   * internal/cmd/plugin/status/status.go, which likewise reads the condition rather than the
   * annotation — the annotation is only the *request* (`on`), while the condition is the
   * reconciled *state* (it stays `False` e.g. while pods are still terminating, and is absent
   * entirely when hibernation was never requested). A hibernated cluster has no instance pods,
   * so detail views built on pod/status data must treat it as a special case rather than an
   * unhealthy cluster.
   */
  get isHibernated(): boolean {
    return parseBool(this.getCondition(HIBERNATION_CONDITION_TYPE)?.status) === true;
  }

  /**
   * Puts the cluster into hibernation (annotation `on`) or rehydrates it (`off`), mirroring
   * `kubectl cnpg hibernate on|off`. Rehydration sets the annotation to `off` rather than
   * removing it, matching the CLI — the operator treats `off` and absent identically.
   */
  setHibernated(hibernated: boolean): Promise<any> {
    return this.patch({
      metadata: {
        annotations: {
          [HIBERNATION_ANNOTATION]: hibernated ? HIBERNATION_ON : 'off',
        },
      },
    } as any);
  }

  get isPhaseHealthy(): boolean {
    return this.phase === PHASE_HEALTHY;
  }

  getCondition(type: string): ClusterCondition | undefined {
    return this.status.conditions?.find(condition => condition.type === type);
  }

  get isArchivingWal(): boolean | undefined {
    const condition = this.getCondition(CONDITION_CONTINUOUS_ARCHIVING);
    return condition ? condition.status === 'True' : undefined;
  }

  /** True/false if CNPG has reported on the last backup, undefined if no backup has run yet. */
  get isLastBackupSucceeded(): boolean | undefined {
    const condition = this.getCondition(CONDITION_LAST_BACKUP_SUCCEEDED);
    return condition ? condition.status === 'True' : undefined;
  }

  get currentPrimary(): string | undefined {
    return this.status.currentPrimary;
  }

  get targetPrimary(): string | undefined {
    return this.status.targetPrimary;
  }

  /** True while CNPG is switching the primary role from currentPrimary to targetPrimary. */
  get isSwitchoverInProgress(): boolean {
    return (
      !!this.currentPrimary && !!this.targetPrimary && this.currentPrimary !== this.targetPrimary
    );
  }

  /** When the current primary was last promoted. */
  get currentPrimaryTimestamp(): string | undefined {
    return this.status.currentPrimaryTimestamp;
  }

  get systemID(): string | undefined {
    return this.status.systemID;
  }

  /** PostgreSQL image actually in use (may lag spec.imageName during a rollout). */
  get image(): string | undefined {
    return this.status.image;
  }

  get timelineID(): number | undefined {
    return this.status.timelineID;
  }

  /** Per-instance state the operator already collected — avoids us needing our own connection. */
  getInstanceReportedState(podName: string): InstanceReportedState | undefined {
    return this.status.instancesReportedState?.[podName];
  }

  get instances(): number {
    return this.spec.instances ?? 0;
  }

  get readyInstances(): number {
    return this.status.readyInstances ?? 0;
  }

  /** Number of synchronous standby replicas required, from whichever config style is in use. */
  get syncReplicasRequired(): number {
    return this.spec.postgresql?.synchronous?.number ?? this.spec.minSyncReplicas ?? 0;
  }

  get hasSynchronousReplication(): boolean {
    return this.instances > 1 && this.syncReplicasRequired > 0;
  }

  /**
   * Traffic-light health for the cluster:
   * - error (red): the cluster phase itself is unhealthy.
   * - warning (yellow): phase is healthy, but WAL archiving and/or the last backup aren't confirmed good.
   * - success (green): phase is healthy, WAL archiving is working, and the last backup succeeded
   *   (or no backup has been configured/taken yet, in which case it isn't held against the cluster).
   *
   * A hibernated cluster has no status to judge, so it reports warning — never success (it isn't
   * running) and never error (nothing is actually wrong). Its label reads 'Hibernated' instead.
   */
  get health(): ClusterHealth {
    if (this.isHibernated) {
      return 'warning';
    }
    if (!this.isPhaseHealthy) {
      return 'error';
    }
    if (this.isArchivingWal === false || this.isLastBackupSucceeded === false) {
      return 'warning';
    }
    return 'success';
  }

  get healthLabel(): string {
    if (this.isHibernated) {
      return 'Hibernated';
    }
    switch (this.health) {
      case 'success':
        return 'Healthy';
      case 'warning':
        return 'Degraded';
      default:
        return 'Unhealthy';
    }
  }

  /** The VolumeSnapshotClass configured for volume-snapshot backups, if any. */
  get volumeSnapshotClassName(): string | undefined {
    return this.spec.backup?.volumeSnapshot?.className;
  }

  /** True if this Cluster archives/uploads backups to the given ObjectStore. */
  referencesObjectStoreAsBackup(objectStoreName: string): boolean {
    return (this.spec.plugins ?? []).some(
      plugin => plugin.parameters?.barmanObjectName === objectStoreName
    );
  }

  /** True if this Cluster was bootstrapped via recovery from the given ObjectStore. */
  referencesObjectStoreAsRecoverySource(objectStoreName: string): boolean {
    return (this.spec.externalClusters ?? []).some(
      external => external.plugin?.parameters?.barmanObjectName === objectStoreName
    );
  }

  get imageCatalogRef(): ImageCatalogRef | undefined {
    return this.spec.imageCatalogRef;
  }

  /** True if this Cluster picks its PostgreSQL image from the given (Cluster)ImageCatalog. */
  referencesImageCatalog(
    catalogKind: 'ImageCatalog' | 'ClusterImageCatalog',
    name: string
  ): boolean {
    return this.imageCatalogRef?.kind === catalogKind && this.imageCatalogRef?.name === name;
  }

  get primaryLabel(): string {
    const currentPrimary = this.currentPrimary || '-';

    if (this.isSwitchoverInProgress) {
      return `${currentPrimary} (targeting ${this.targetPrimary})`;
    }

    return currentPrimary;
  }
}
