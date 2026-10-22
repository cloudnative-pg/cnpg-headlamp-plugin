import { SecretKeyRef } from '../../../resources/objectStore';

export type KlioServerMode = 'standard' | 'read-only';

/** One `encryptionKeyFile`/`identityFile` fileReference, restricted to Secret volumes in the
 *  form (the CRD accepts any VolumeSource — use the YAML override for CSI and friends). */
export interface KlioFileReferenceState {
  secretName: string;
  path: string;
}

export interface KlioS3FormState {
  bucketName: string;
  prefix: string;
  endpoint: string;
  region: string;
  /** False selects the IAM-role path: credentials are omitted and the AWS SDK uses the pod role. */
  useCredentials: boolean;
  accessKeyId: SecretKeyRef;
  secretAccessKey: SecretKeyRef;
  useCustomCa: boolean;
  customCaBundle: SecretKeyRef;
}

export interface KlioServerCreateFormState {
  namespace: string;
  name: string;
  mode: KlioServerMode;
  image: string;
  imagePullPolicy: string;
  tlsSecretName: string;
  caSecretName: string;
  storageSize: string;
  storageClass?: string;
  accessModes: string[];
  tier1EncryptionKey: KlioFileReferenceState;
  tier1Identity: KlioFileReferenceState;
  tier2Enabled: boolean;
  tier2EncryptionKey: KlioFileReferenceState;
  tier2Identity: KlioFileReferenceState;
  s3: KlioS3FormState;
}

const emptySecretKeyRef: SecretKeyRef = { name: '', key: '' };
const emptyFileReference: KlioFileReferenceState = { secretName: '', path: '' };

export function defaultKlioServerFormState(): KlioServerCreateFormState {
  return {
    namespace: '',
    name: '',
    mode: 'standard',
    image: '',
    imagePullPolicy: 'IfNotPresent',
    tlsSecretName: '',
    caSecretName: '',
    storageSize: '3Gi',
    storageClass: undefined,
    accessModes: ['ReadWriteOnce'],
    tier1EncryptionKey: { ...emptyFileReference },
    tier1Identity: { ...emptyFileReference },
    tier2Enabled: false,
    tier2EncryptionKey: { ...emptyFileReference },
    tier2Identity: { ...emptyFileReference },
    s3: {
      bucketName: '',
      prefix: '',
      endpoint: '',
      region: '',
      useCredentials: true,
      accessKeyId: { ...emptySecretKeyRef },
      secretAccessKey: { ...emptySecretKeyRef },
      useCustomCa: false,
      customCaBundle: { ...emptySecretKeyRef },
    },
  };
}

function buildFileReference(state: KlioFileReferenceState) {
  return {
    fileReference: {
      path: state.path,
      volume: { secret: { secretName: state.secretName } },
    },
  };
}

function buildS3(state: KlioS3FormState) {
  const s3: Record<string, any> = { bucketName: state.bucketName };
  if (state.prefix) {
    s3.prefix = state.prefix;
  }
  if (state.endpoint) {
    s3.endpoint = state.endpoint;
  }
  if (state.region) {
    s3.region = state.region;
  }
  if (state.useCredentials) {
    s3.accessKeyId = state.accessKeyId;
    s3.secretAccessKey = state.secretAccessKey;
  }
  if (state.useCustomCa) {
    s3.customCaBundle = state.customCaBundle;
  }
  return s3;
}

// Builds the Server manifest from form state — shared by the YAML preview and the actual
// submit so the two can never drift apart.
export function buildKlioServerManifest(state: KlioServerCreateFormState) {
  const spec: Record<string, any> = {
    image: state.image,
    imagePullPolicy: state.imagePullPolicy,
    mode: state.mode,
    caSecretName: state.caSecretName,
    tlsSecretName: state.tlsSecretName,
    storage: {
      pvcTemplate: {
        ...(state.accessModes.length > 0 && { accessModes: state.accessModes }),
        ...(state.storageClass && { storageClassName: state.storageClass }),
        resources: { requests: { storage: state.storageSize } },
      },
    },
  };

  // mode is immutable: a read-only server serves Tier 2 only and must not carry tier1.
  if (state.mode === 'standard') {
    spec.tier1 = {
      encryptionKeyFile: buildFileReference(state.tier1EncryptionKey),
      identityFile: buildFileReference(state.tier1Identity),
    };
  }

  if (state.tier2Enabled || state.mode === 'read-only') {
    spec.tier2 = {
      encryptionKeyFile: buildFileReference(state.tier2EncryptionKey),
      identityFile: buildFileReference(state.tier2Identity),
      s3: buildS3(state.s3),
    };
  }

  return {
    apiVersion: 'klio.cnpg.io/v1alpha1',
    kind: 'Server',
    metadata: { name: state.name, namespace: state.namespace },
    spec,
  };
}

export interface KlioServerSummary {
  name: string;
  mode: string;
  image: string;
  storage: string;
  tier1: string;
  tier2: string;
}

export function deriveKlioServerSummary(state: KlioServerCreateFormState): KlioServerSummary {
  const tier2Active = state.tier2Enabled || state.mode === 'read-only';
  return {
    name: state.name || '-',
    mode: state.mode,
    image: state.image || '-',
    storage: state.storageSize || '-',
    tier1: state.mode === 'read-only' ? 'Disabled (read-only)' : 'Local PVC',
    tier2: tier2Active ? state.s3.bucketName || 'S3 (no bucket yet)' : 'Disabled',
  };
}

function isFileReferenceComplete(ref: KlioFileReferenceState): boolean {
  return !!ref.secretName && !!ref.path;
}

function isSecretKeyRefComplete(ref: SecretKeyRef): boolean {
  return !!ref.name && !!ref.key;
}

export function getKlioServerValidationErrors(state: KlioServerCreateFormState): string[] {
  const errors: string[] = [];
  if (!state.namespace) {
    errors.push('Namespace is required.');
  }
  if (!state.name) {
    errors.push('Name is required.');
  }
  if (!state.image.trim()) {
    errors.push('Image is required.');
  }
  if (!state.tlsSecretName) {
    errors.push('TLS secret is required.');
  }
  if (!state.caSecretName) {
    errors.push('CA secret is required.');
  }
  if (!state.storageSize) {
    errors.push('Storage size is required.');
  }
  if (state.mode === 'standard') {
    if (
      !isFileReferenceComplete(state.tier1EncryptionKey) ||
      !isFileReferenceComplete(state.tier1Identity)
    ) {
      errors.push('Tier 1 encryption key and identity files are required.');
    }
  }
  if (state.tier2Enabled || state.mode === 'read-only') {
    if (
      !isFileReferenceComplete(state.tier2EncryptionKey) ||
      !isFileReferenceComplete(state.tier2Identity)
    ) {
      errors.push('Tier 2 encryption key and identity files are required.');
    }
    if (!state.s3.bucketName.trim()) {
      errors.push('Tier 2 bucket name is required.');
    }
    if (
      state.s3.useCredentials &&
      (!isSecretKeyRefComplete(state.s3.accessKeyId) ||
        !isSecretKeyRefComplete(state.s3.secretAccessKey))
    ) {
      errors.push('Tier 2 access key ID and secret access key are required.');
    }
    if (state.s3.useCustomCa && !isSecretKeyRefComplete(state.s3.customCaBundle)) {
      errors.push('Tier 2 custom CA bundle is required when enabled.');
    }
  }
  return errors;
}
