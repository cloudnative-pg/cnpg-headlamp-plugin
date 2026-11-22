import { Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Link from '@mui/material/Link';
import { useHistory } from 'react-router-dom';

const { createRouteURL } = Router;

/** Whether the Barman Cloud plugin's ObjectStore CRD is installed on the cluster, inferred from
 *  the error (if any) of ObjectStore's own list call rather than a separate cluster-wide
 *  CustomResourceDefinition list. A CustomResourceDefinition list needs its own cluster-scoped
 *  RBAC, which namespace-scoped users (e.g. bound only via a Role in one namespace) don't have —
 *  that denial used to resolve to an empty CRD list and get misread as "not installed",
 *  hiding ObjectStores such a user otherwise has every right to see. A 404 here means the
 *  apiserver doesn't know the resource type at all (CRD genuinely missing); any other error
 *  (e.g. 403 from namespace-scoped RBAC) or no error means the CRD is there. */
export function barmanCloudCrdInstalled(listError: { status?: number } | null): boolean {
  return listError?.status !== 404;
}

/** Shown by the ObjectStores views instead of an empty/broken list when the Barman Cloud
 *  plugin's ObjectStore CRD isn't installed — ObjectStore.useList() has nothing to query
 *  otherwise, since the CRD it targets doesn't exist on the cluster. */
export function BarmanCloudNotInstalled({ title }: { title: string }) {
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
        <AlertTitle>Barman Cloud plugin not installed</AlertTitle>
        ObjectStore is one of its CRDs, not a core CloudNativePG resource.
      </Alert>
    </SectionBox>
  );
}
