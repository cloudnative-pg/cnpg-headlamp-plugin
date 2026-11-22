import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { ImageCatalog } from '../../resources/imageCatalog';
import { CatalogImageRow, CatalogImagesEditor } from '../common/CatalogImagesEditor';
import { NamespaceField } from '../common/NamespaceField';
import { RequiredLabel } from '../common/RequiredLabel';
import { YamlPreview } from '../common/YamlPreview';

interface ImageCatalogFormState {
  namespace: string;
  name: string;
  images: CatalogImageRow[];
}

function buildImageCatalogManifest(state: ImageCatalogFormState) {
  return {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'ImageCatalog',
    metadata: { name: state.name, namespace: state.namespace },
    spec: {
      images: state.images.map(({ major, image }) => ({ major, image })),
    },
  };
}

function ImageCatalogCreateForm({ onClose }: { onClose: () => void }) {
  const [namespace, setNamespace] = useState('');
  const [name, setName] = useState('');
  const [images, setImages] = useState<CatalogImageRow[]>([
    { id: 'imagecatalog-image-0', major: 17, image: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set while the YamlPreview's "Edit" switch is on — takes precedence over the form-derived
  // manifest below at submit time. See YamlPreview.tsx for why this is an override rather than
  // something synced back onto the form fields.
  const [manifestOverride, setManifestOverride] = useState<object | null>(null);

  const imagesValid = images.length > 0 && images.every(row => row.major > 0 && !!row.image);
  const canSubmit = !!namespace && !!name && imagesValid && !submitting;

  const manifest = useMemo(
    () => buildImageCatalogManifest({ namespace, name, images }),
    [namespace, name, images]
  );

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ImageCatalog.apiEndpoint.post(manifestOverride ?? manifest);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create image catalog');
      setSubmitting(false);
    }
  }

  return (
    <SectionBox title="Create ImageCatalog">
      <NamespaceField idPrefix="imagecatalog" value={namespace} onChange={setNamespace} />

      <TextField
        fullWidth
        margin="normal"
        label={<RequiredLabel label="Name" required />}
        value={name}
        onChange={e => setName(e.target.value)}
      />

      <Typography variant="subtitle1" sx={{ mt: 2 }}>
        Images
      </Typography>
      <CatalogImagesEditor idPrefix="imagecatalog-image" rows={images} onChange={setImages} />

      <YamlPreview manifest={manifest} onOverrideChange={setManifestOverride} />

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}

      <Button
        variant="contained"
        color="primary"
        sx={{ mt: 2 }}
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        Create
      </Button>
    </SectionBox>
  );
}

// Opens the create form in an overlay, same convention as launchObjectStoreCreate in
// components/objectstores/Create.tsx.
export function launchImageCatalogCreate() {
  const activityId = 'cnpg-imagecatalog-create';
  Activity.launch({
    id: activityId,
    title: 'Create ImageCatalog',
    icon: <Icon icon="mdi:plus-circle" width="100%" height="100%" />,
    location: 'split-right',
    content: <ImageCatalogCreateForm onClose={() => Activity.close(activityId)} />,
  });
}
