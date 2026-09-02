import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { BackupMethod, BackupTarget } from './backup';

export type BackupOwnerReference = 'none' | 'self' | 'cluster';

export interface CnpgScheduledBackup extends KubeObjectInterface {
  spec: {
    schedule: string;
    cluster: {
      name: string;
    };
    backupOwnerReference?: BackupOwnerReference;
    immediate?: boolean;
    suspend?: boolean;
    method?: BackupMethod;
    target?: BackupTarget;
    pluginConfiguration?: {
      name: string;
      parameters?: Record<string, string>;
    };
    [otherProps: string]: any;
  };
  status?: {
    lastCheckTime?: string;
    lastScheduleTime?: string;
    nextScheduleTime?: string;
    [otherProps: string]: any;
  };
}

export class ScheduledBackup extends KubeObject<CnpgScheduledBackup> {
  static kind = 'ScheduledBackup';
  static apiName = 'scheduledbackups';
  static apiVersion = 'postgresql.cnpg.io/v1';
  static isNamespaced = true;

  // See the equivalent comment on Cluster.detailsRoute in cluster.ts — same workaround.
  static get detailsRoute() {
    return '/cnpg/scheduledbackups/:namespace/:name';
  }

  static get listRoute() {
    return '/cnpg/scheduledbackups';
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

  get schedule(): string {
    return this.spec.schedule;
  }

  get suspend(): boolean {
    return this.spec.suspend ?? false;
  }

  get immediate(): boolean {
    return this.spec.immediate ?? false;
  }

  get backupOwnerReference(): BackupOwnerReference | undefined {
    return this.spec.backupOwnerReference;
  }

  get method(): BackupMethod | undefined {
    return this.spec.method;
  }

  get target(): BackupTarget | undefined {
    return this.spec.target;
  }

  get pluginConfiguration(): { name: string; parameters?: Record<string, string> } | undefined {
    return this.spec.pluginConfiguration;
  }

  get lastCheckTime(): string | undefined {
    return this.status.lastCheckTime;
  }

  get lastScheduleTime(): string | undefined {
    return this.status.lastScheduleTime;
  }

  get nextScheduleTime(): string | undefined {
    return this.status.nextScheduleTime;
  }
}
