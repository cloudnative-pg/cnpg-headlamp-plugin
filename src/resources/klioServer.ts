import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

/** A reference to a single key within a Secret, as used by the tier2 S3 config. */
export interface KlioSecretKeyRef {
  name: string;
  key: string;
}

/** `encryptionKeyFile` / `identityFile`: a file projected from a volume. */
export interface KlioFileReference {
  fileReference: {
    path: string;
    volume: Record<string, any>;
  };
  [otherProps: string]: any;
}

export interface KlioS3Configuration {
  bucketName: string;
  prefix?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: KlioSecretKeyRef;
  secretAccessKey?: KlioSecretKeyRef;
  sessionToken?: KlioSecretKeyRef;
  customCaBundle?: KlioSecretKeyRef;
  [otherProps: string]: any;
}

export interface KlioTierConfiguration {
  encryptionKeyFile?: KlioFileReference;
  identityFile?: KlioFileReference;
  compression?: string;
  s3?: KlioS3Configuration;
  [otherProps: string]: any;
}

export interface CnpgKlioServer extends KubeObjectInterface {
  spec: {
    image?: string;
    imagePullPolicy?: string;
    imagePullSecrets?: { name: string }[];
    mode?: 'standard' | 'read-only';
    caSecretName?: string;
    tlsSecretName?: string;
    storage?: {
      pvcTemplate?: {
        accessModes?: string[];
        storageClassName?: string;
        resources?: {
          requests?: Record<string, string>;
        };
        [otherProps: string]: any;
      };
      [otherProps: string]: any;
    };
    tier1?: KlioTierConfiguration;
    tier2?: KlioTierConfiguration;
    template?: Record<string, any>;
    [otherProps: string]: any;
  };
  status?: Record<string, any>;
}

export class KlioServer extends KubeObject<CnpgKlioServer> {
  static kind = 'Server';
  static apiName = 'servers';
  static apiVersion = 'klio.cnpg.io/v1alpha1';
  static isNamespaced = true;

  // Seeds the "Create" YAML editor with a minimal working example instead of an empty object.
  // The guided form is components/klioservers/create/CreatePage.tsx — this is only a
  // fallback for anything that falls back to a raw-YAML create flow.
  static getBaseObject() {
    return {
      apiVersion: 'klio.cnpg.io/v1alpha1',
      kind: 'Server',
      metadata: {
        name: '',
      },
      spec: {
        image: '',
        imagePullPolicy: 'IfNotPresent',
        mode: 'standard',
        caSecretName: '',
        tlsSecretName: '',
        storage: {
          pvcTemplate: {
            accessModes: ['ReadWriteOnce'],
            resources: {
              requests: {
                storage: '3Gi',
              },
            },
          },
        },
        tier1: {
          encryptionKeyFile: {
            fileReference: {
              path: '',
              volume: { secret: { secretName: '' } },
            },
          },
          identityFile: {
            fileReference: {
              path: '',
              volume: { secret: { secretName: '' } },
            },
          },
        },
      },
    };
  }

  // See the equivalent comment on Cluster.detailsRoute in cluster.ts — same workaround.
  static get detailsRoute() {
    return '/cnpg/klioservers/:namespace/:name';
  }

  static get listRoute() {
    return '/cnpg/klioservers';
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

  get mode(): string {
    return this.spec.mode ?? 'standard';
  }

  get image(): string | undefined {
    return this.spec.image;
  }

  get imagePullPolicy(): string | undefined {
    return this.spec.imagePullPolicy;
  }

  get tlsSecretName(): string | undefined {
    return this.spec.tlsSecretName;
  }

  get caSecretName(): string | undefined {
    return this.spec.caSecretName;
  }

  get storageSize(): string | undefined {
    return this.spec.storage?.pvcTemplate?.resources?.requests?.['storage'];
  }

  get storageClassName(): string | undefined {
    return this.spec.storage?.pvcTemplate?.storageClassName;
  }

  get accessModes(): string[] {
    return this.spec.storage?.pvcTemplate?.accessModes ?? [];
  }

  get hasTier1(): boolean {
    return !!this.spec.tier1;
  }

  get hasTier2(): boolean {
    return !!this.spec.tier2;
  }

  get s3BucketName(): string | undefined {
    return this.spec.tier2?.s3?.bucketName;
  }

  get s3Endpoint(): string | undefined {
    return this.spec.tier2?.s3?.endpoint;
  }

  get s3Prefix(): string | undefined {
    return this.spec.tier2?.s3?.prefix;
  }
}
