import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

/** A single Kopia-style retention rule set, as used by tier1/tier2 retention. */
export interface KlioRetentionPolicy {
  keepLatest?: number;
  keepHourly?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepAnnual?: number;
  [otherProps: string]: any;
}

/** A single entry in PluginConfiguration.status.conditions. */
export interface KlioConfigCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface CnpgPluginConfiguration extends KubeObjectInterface {
  spec: {
    serverAddress: string;
    clientSecretName: string;
    serverSecretName: string;
    clusterName: string;
    mode?: 'standard' | 'read-only';
    pprof?: boolean;
    tier1?: {
      retention?: KlioRetentionPolicy;
      compression?: string;
      [otherProps: string]: any;
    };
    tier2?: {
      enableBackup?: boolean;
      enableRecovery?: boolean;
      retention?: KlioRetentionPolicy;
      compression?: string;
      [otherProps: string]: any;
    };
    walPrefetch?: {
      count?: number;
      maxConcurrentDownloads?: number;
      [otherProps: string]: any;
    };
    containers?: Record<string, any>[];
    [otherProps: string]: any;
  };
  status?: {
    conditions?: KlioConfigCondition[];
    [otherProps: string]: any;
  };
}

export class PluginConfiguration extends KubeObject<CnpgPluginConfiguration> {
  static kind = 'PluginConfiguration';
  static apiName = 'pluginconfigurations';
  static apiVersion = 'klio.cnpg.io/v1alpha1';
  static isNamespaced = true;

  // Seeds the "Create" YAML editor with a minimal working example instead of an empty object.
  // The guided form is components/klioconfigs/create/CreatePage.tsx — this is only a
  // fallback for anything that falls back to a raw-YAML create flow.
  static getBaseObject() {
    return {
      apiVersion: 'klio.cnpg.io/v1alpha1',
      kind: 'PluginConfiguration',
      metadata: {
        name: '',
      },
      spec: {
        serverAddress: '',
        clientSecretName: '',
        serverSecretName: '',
        clusterName: '',
        mode: 'standard',
      },
    };
  }

  // See the equivalent comment on Cluster.detailsRoute in cluster.ts — same workaround.
  static get detailsRoute() {
    return '/cnpg/klioconfigs/:namespace/:name';
  }

  static get listRoute() {
    return '/cnpg/klioconfigs';
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

  get serverAddress(): string {
    return this.spec.serverAddress;
  }

  get clusterName(): string {
    return this.spec.clusterName;
  }

  get mode(): string {
    return this.spec.mode ?? 'standard';
  }

  get clientSecretName(): string {
    return this.spec.clientSecretName;
  }

  get serverSecretName(): string {
    return this.spec.serverSecretName;
  }

  get tier2BackupEnabled(): boolean {
    return !!this.spec.tier2?.enableBackup;
  }

  get tier2RecoveryEnabled(): boolean {
    return !!this.spec.tier2?.enableRecovery;
  }

  getConditions(): KlioConfigCondition[] {
    return this.status.conditions ?? [];
  }

  getCondition(type: string): KlioConfigCondition | undefined {
    return this.getConditions().find(condition => condition.type === type);
  }

  /** True/false if the operator has reported on the applied configuration, undefined if unknown. */
  get isConfigurationApplied(): boolean | undefined {
    const condition = this.getCondition('ConfigurationApplied');
    return condition ? condition.status === 'True' : undefined;
  }
}
