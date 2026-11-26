import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Link from '@mui/material/Link';
import { useHistory } from 'react-router-dom';

const { createRouteURL } = Router;

// Full names of the Klio CRDs, as they appear in
// CustomResourceDefinition.metadata.name.
const KLIO_SERVER_CRD = 'servers.klio.cnpg.io';
const KLIO_PLUGINCONFIGURATION_CRD = 'pluginconfigurations.klio.cnpg.io';

/** Whether both Klio CRDs are installed on the cluster. `null` while the
 *  CustomResourceDefinition list is still loading — callers should treat that the same as
 *  "assume installed" so pages don't flash a false "not installed" state before the check
 *  resolves. */
export function useKlioCrdInstalled(): boolean | null {
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  if (crds === null) {
    return null;
  }
  const names = new Set(crds.map(crd => crd.getName()));
  return names.has(KLIO_SERVER_CRD) && names.has(KLIO_PLUGINCONFIGURATION_CRD);
}

/** Shown by the Klio views instead of an empty/broken list when the Klio CRDs aren't
 *  installed — KlioServer/PluginConfiguration.useList() have nothing to query otherwise,
 *  since the CRDs they target don't exist on the cluster. */
export function KlioNotInstalled({ title }: { title: string }) {
  const history = useHistory();

  return (
    <SectionBox title={title}>
      {/* severity="warning" renders near-invisible text in Headlamp's dark theme — its
          palette.warning.light is a translucent color meant for a different component, and
          MUI's Alert derives its text color from that same value. Headlamp's theme doesn't
          override palette.info at all, so it falls back to MUI's own (unaffected) default. */}
      <Alert
        severity="info"
        action={
          <Link
            component="button"
            underline="always"
            sx={{ mr: 1 }}
            onClick={() => history.push(createRouteURL('CNPG Status'))}
          >
            Operator status
          </Link>
        }
      >
        <AlertTitle>Klio not installed</AlertTitle>
        Server and PluginConfiguration are Klio CRDs, not core CloudNativePG resources.
      </Alert>
    </SectionBox>
  );
}
