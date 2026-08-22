import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export type BackupMethod = 'barmanObjectStore' | 'volumeSnapshot' | 'plugin';
export type BackupTarget = 'primary' | 'prefer-standby';

/**
 * Known status.phase values (from CNPG's api/v1/backup_types.go) — status.phase itself is a
 * free string on the CRD, so this is a hint for display purposes, not an exhaustive guarantee.
 */
export type BackupPhase =
  | 'pending'
  | 'started'
  | 'running'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'walArchivingFailing'
  | 'invalid backup definition';

interface BackupInstanceID {
  podName?: string;
  ContainerID?: string;
  sessionID?: string;
}

export interface CnpgBackup extends KubeObjectInterface {
  spec: {
    cluster: {
      name: string;
    };
    method: BackupMethod;
    target?: BackupTarget;
    pluginConfiguration?: {
      name: string;
      parameters?: Record<string, string>;
    };
    [otherProps: string]: any;
  };
  status?: {
    phase?: string;
    error?: string;
    backupId?: string;
    backupName?: string;
    beginLSN?: string;
    endLSN?: string;
    beginWal?: string;
    endWal?: string;
    startedAt?: string;
    stoppedAt?: string;
    method?: string;
    online?: boolean;
    majorVersion?: number;
    instanceID?: BackupInstanceID;
    [otherProps: string]: any;
  };
}

export class Backup extends KubeObject<CnpgBackup> {
  static kind = 'Backup';
  static apiName = 'backups';
  static apiVersion = 'postgresql.cnpg.io/v1';
  static isNamespaced = true;

  // See the equivalent comment on Cluster.detailsRoute in cluster.ts — same workaround.
  static get detailsRoute() {
    return '/cnpg/backups/:namespace/:name';
  }

  static get listRoute() {
    return '/cnpg/backups';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status ?? {};
  }

  // See the equivalent comment on Pooler.metadata in pooler.ts — same workaround.
  get metadata() {
    const metadata = { ...super.metadata };
    delete metadata.annotations;
    return metadata;
  }

  get clusterName(): string {
    return this.spec.cluster.name;
  }

  get method(): BackupMethod {
    return this.spec.method;
  }

  get target(): BackupTarget | undefined {
    return this.spec.target;
  }

  get pluginConfiguration(): { name: string; parameters?: Record<string, string> } | undefined {
    return this.spec.pluginConfiguration;
  }

  get phase(): string | undefined {
    return this.status.phase;
  }

  get error(): string | undefined {
    return this.status.error;
  }

  get startedAt(): string | undefined {
    return this.status.startedAt;
  }

  get stoppedAt(): string | undefined {
    return this.status.stoppedAt;
  }
}
