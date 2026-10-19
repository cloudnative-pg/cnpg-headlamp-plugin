import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export interface CnpgPluginConfiguration extends KubeObjectInterface {
  spec?: Record<string, any>;
}

// Provided by the Klio CNPG-I plugin's CRDs, namespaced. Used here purely as a picker data
// source for the recovery plugin's pluginConfigurationRef parameter, so it has no
// detailsRoute/listRoute (no list/detail view registered for it) — same pattern as
// VolumeSnapshotClass in volumeSnapshotClass.ts.
export class PluginConfiguration extends KubeObject<CnpgPluginConfiguration> {
  static kind = 'PluginConfiguration';
  static apiName = 'pluginconfigurations';
  static apiVersion = 'klio.cnpg.io/v1alpha1';
  static isNamespaced = true;
}
