import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { CnpgLogo } from '../common/CnpgLogo';

const { createRouteURL } = Router;

export const CERT_MANAGER_CRD = 'certificates.cert-manager.io';
const CERT_MANAGER_LABEL = 'app.kubernetes.io/name=cert-manager';

export const BARMAN_PLUGIN_ID = 'barman-cloud.cloudnative-pg.io';
export const KLIO_PLUGIN_ID = 'klio.cnpg.io';

/** Label marking namespaces created from this plugin's install guide, so a
 *  custom namespace stays visible after creation (and across reloads). */
export const NAMESPACE_CREATED_FOR_LABEL = 'cnpg-headlamp-plugin.io/created-for';
export const CNPG_CREATED_FOR = 'cloudnative-pg';
export const CERT_MANAGER_CREATED_FOR = 'cert-manager';

/** Pure helper, kept outside the hook so it stays unit-testable without a cluster. */
export function getCustomCreatedNamespaces(
  namespaces: { getName(): string; metadata?: { labels?: Record<string, string> } | null }[],
  createdFor: string,
  defaultName: string
): string[] {
  return namespaces
    .filter(
      ns =>
        ns.getName() !== defaultName &&
        ns.metadata?.labels?.[NAMESPACE_CREATED_FOR_LABEL] === createdFor
    )
    .map(ns => ns.getName());
}

// Deep links into the Headlamp App Catalog's chart-detail route
// (/helm/:repoName/charts/:chartName), which resolves the official, CNCF-published charts via
// ArtifactHub. When the App Catalog route isn't registered (e.g. Headlamp running without the
// app-catalog plugin), fall back to opening the same ArtifactHub chart page in a new tab.
const CHARTS = {
  cnpg: {
    repoName: 'cloudnative-pg',
    chartName: 'cloudnative-pg',
    fallback: 'https://artifacthub.io/packages/helm/cloudnative-pg/cloudnative-pg',
  },
  certManager: {
    repoName: 'cert-manager',
    chartName: 'cert-manager',
    fallback: 'https://artifacthub.io/packages/helm/cert-manager/cert-manager',
  },
  barman: {
    repoName: 'cloudnative-pg',
    chartName: 'plugin-barman-cloud',
    fallback: 'https://artifacthub.io/packages/helm/cloudnative-pg/plugin-barman-cloud',
  },
} as const;

type ChartRef = (typeof CHARTS)[keyof typeof CHARTS];

export const DOC_URLS = {
  cnpg: 'https://cloudnative-pg.io/documentation/',
  certManager: 'https://cert-manager.io/docs/',
  barman: 'https://cloudnative-pg.github.io/plugin-barman-cloud/',
  klio: 'https://cloudnative-pg.io/klio/',
} as const;

/** Pure check, kept outside the hook so it stays unit-testable without a cluster. */
export function isCertManagerInstalled(
  crdNames: string[],
  certManagerDeployments: number
): boolean {
  return crdNames.some(name => name === CERT_MANAGER_CRD) && certManagerDeployments > 0;
}

export function useCertManagerStatus(crds: { getName(): string }[] | null): {
  installed: boolean;
  loading: boolean;
} {
  // The official Jetstack chart labels its Deployments with app.kubernetes.io/name=cert-manager.
  const [deployments] = K8s.ResourceClasses.Deployment.useList({
    labelSelector: CERT_MANAGER_LABEL,
  });
  if (crds === null || deployments === null) {
    return { installed: false, loading: true };
  }
  return {
    installed: isCertManagerInstalled(
      crds.map(c => c.getName()),
      deployments.length
    ),
    loading: false,
  };
}

/**
 * Opens an official chart's page in the Headlamp App Catalog via the router so the cluster
 * prefix is preserved. The catalog is a separate feature — its route only exists when the
 * app-catalog plugin is installed — so when no route resolves we fall back to opening the
 * same ArtifactHub chart page in a new tab.
 */
function useOpenAppCatalog() {
  const history = useHistory();
  return (chart: ChartRef) => {
    const chartUrl = createRouteURL('/helm/:repoName/charts/:chartName', {
      repoName: chart.repoName,
      chartName: chart.chartName,
    });
    if (chartUrl) {
      history.push(chartUrl);
    } else {
      window.open(chart.fallback, '_blank', 'noopener,noreferrer');
    }
  };
}

function StatusChip({ installed, checking }: { installed: boolean; checking: boolean }) {
  if (checking) {
    return <Chip label="Checking…" size="small" variant="outlined" />;
  }
  return installed ? (
    <Chip label="Installed" size="small" color="success" />
  ) : (
    <Chip
      label="Not installed"
      size="small"
      sx={theme => ({
        backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : '#eef1f6',
        color: theme.palette.text.secondary,
        fontWeight: 500,
      })}
    />
  );
}

function CheckList({ items }: { items: string[] }) {
  return (
    <Box component="ul" sx={{ m: 0, mt: 1, p: 0, listStyle: 'none' }}>
      {items.map(item => (
        <Box
          key={item}
          component="li"
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.75 }}
        >
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              flexShrink: 0,
              mt: '1px',
              color: theme => (theme.palette.mode === 'dark' ? '#66bb6a' : '#2e7d32'),
            }}
          >
            <Icon icon="mdi:check-circle" width={18} height={18} />
          </Box>
          <Typography variant="body2">{item}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function NamespaceCreateButton({ name, createdFor }: { name: string; createdFor: string }) {
  const { enqueueSnackbar } = useSnackbar();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const NamespaceClass = K8s.ResourceClasses.Namespace;

  if (created) {
    return <NamespaceExistsNote name={name} />;
  }

  return (
    <AuthDisabledButton
      item={NamespaceClass}
      authVerb="create"
      deniedMessage="You don't have permission to create Namespaces."
    >
      <Button
        variant="outlined"
        size="small"
        disabled={creating}
        onClick={() => {
          setCreating(true);
          NamespaceClass.apiEndpoint
            .post({
              apiVersion: 'v1',
              kind: 'Namespace',
              metadata: { name, labels: { [NAMESPACE_CREATED_FOR_LABEL]: createdFor } },
            })
            .then(() => {
              setCreated(true);
              enqueueSnackbar(`Namespace "${name}" created`, { variant: 'success' });
            })
            .catch((err: unknown) => {
              setCreating(false);
              enqueueSnackbar(
                err instanceof Error ? err.message : `Failed to create namespace "${name}"`,
                { variant: 'error' }
              );
            });
        }}
      >
        {creating ? 'Creating…' : `Create namespace "${name}"`}
      </Button>
    </AuthDisabledButton>
  );
}

function NamespaceExistsNote({ name }: { name: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          color: theme => (theme.palette.mode === 'dark' ? '#66bb6a' : '#2e7d32'),
        }}
      >
        <Icon icon="mdi:check-circle" width={16} height={16} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        Namespace &quot;{name}&quot; ready — select it when installing
      </Typography>
    </Box>
  );
}

/** Lets the user type a custom namespace name and create it directly in Headlamp. */
function CustomNamespaceCreate({ createdFor }: { createdFor: string }) {
  const { enqueueSnackbar } = useSnackbar();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const NamespaceClass = K8s.ResourceClasses.Namespace;
  const trimmed = name.trim().toLowerCase();
  const valid = trimmed.length > 0 && NamespaceClass.isValidNamespaceFormat(trimmed);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        flexGrow: 1,
        minWidth: 180,
      }}
    >
      <TextField
        size="small"
        label="Custom namespace"
        placeholder="e.g. my-cnpg"
        value={name}
        onChange={e => setName(e.target.value)}
        error={name.length > 0 && !valid}
        helperText={
          name.length > 0 && !valid ? 'Lowercase letters, numbers and dashes.' : undefined
        }
        sx={{ flexGrow: 1 }}
      />
      <AuthDisabledButton
        item={NamespaceClass}
        authVerb="create"
        deniedMessage="You don't have permission to create Namespaces."
      >
        <Button
          variant="outlined"
          size="small"
          disabled={!valid || creating}
          sx={{ mt: 0.5, flexShrink: 0 }}
          onClick={() => {
            setCreating(true);
            NamespaceClass.apiEndpoint
              .post({
                apiVersion: 'v1',
                kind: 'Namespace',
                metadata: {
                  name: trimmed,
                  labels: { [NAMESPACE_CREATED_FOR_LABEL]: createdFor },
                },
              })
              .then(() => {
                setCreating(false);
                setName('');
                enqueueSnackbar(`Namespace "${trimmed}" created`, { variant: 'success' });
              })
              .catch((err: unknown) => {
                setCreating(false);
                enqueueSnackbar(
                  err instanceof Error ? err.message : `Failed to create namespace "${trimmed}"`,
                  { variant: 'error' }
                );
              });
          }}
        >
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </AuthDisabledButton>
    </Box>
  );
}

/** Copyable Helm values snippet, e.g. settings the chart requires to work with CNPG. */
function RequiredValuesNote({ values }: { values: string }) {
  const { enqueueSnackbar } = useSnackbar();

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary">
        Required Helm values
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Paste into the Values field when installing from the App Catalog.
      </Typography>
      <Box
        sx={theme => ({
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          p: 1,
          borderRadius: 1,
          backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#eef1f6',
        })}
      >
        <Box
          component="pre"
          sx={{ m: 0, flexGrow: 1, fontSize: 11, overflowX: 'auto', color: 'text.secondary' }}
        >
          {values}
        </Box>
        <Tooltip title="Copy to clipboard">
          <IconButton
            size="small"
            aria-label="Copy Helm values"
            onClick={() => {
              navigator.clipboard
                .writeText(values)
                .then(() => enqueueSnackbar('Helm values copied', { variant: 'success' }))
                .catch((err: unknown) =>
                  enqueueSnackbar(
                    err instanceof Error ? err.message : 'Failed to copy Helm values',
                    { variant: 'error' }
                  )
                );
            }}
          >
            <Icon icon="mdi:content-copy" width={16} height={16} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function PrereqList({
  items,
  namespace,
  createdFor,
  customNamespaces = [],
}: {
  items: string[];
  /** Suggested namespace: offers one-click creation in Headlamp (no kubectl needed), or a
   *  confirmation when it already exists. `exists: null` while the namespace list loads. */
  namespace?: { name: string; exists: boolean | null };
  /** Value for the {@link NAMESPACE_CREATED_FOR_LABEL} label: tracks custom namespaces
   *  created from this card so they stay visible after creation. */
  createdFor?: string;
  /** Namespaces previously created from this card via the custom-namespace input
   *  (labelled, excluding the suggested name which has its own note). */
  customNamespaces?: string[];
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
      <Box sx={{ color: 'text.secondary', flexShrink: 0, mt: '2px' }}>
        <Icon icon="mdi:cube-outline" width={18} height={18} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary">
          Prerequisites
        </Typography>
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
          {items.map(item => (
            <Typography key={item} component="li" variant="body2" color="text.secondary">
              {item}
            </Typography>
          ))}
        </Box>
        {namespace && namespace.exists === null && (
          <Typography variant="caption" color="text.secondary">
            Checking namespace…
          </Typography>
        )}
        {namespace && namespace.exists === true && <NamespaceExistsNote name={namespace.name} />}
        {customNamespaces.map(name => (
          <NamespaceExistsNote key={name} name={name} />
        ))}
        {namespace && namespace.exists === false && customNamespaces.length === 0 && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <NamespaceCreateButton
              key={namespace.name}
              name={namespace.name}
              createdFor={createdFor ?? namespace.name}
            />
            <Typography variant="caption" color="text.secondary">
              or
            </Typography>
            <CustomNamespaceCreate createdFor={createdFor ?? namespace.name} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

function CardHeader({
  icon,
  name,
  subtitle,
  installed,
  checking,
}: {
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  installed: boolean;
  checking: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
      <Box sx={{ flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} lineHeight={1.2}>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {subtitle}
        </Typography>
      </Box>
      <StatusChip installed={installed} checking={checking} />
    </Box>
  );
}

function CircleIcon({ icon }: { icon: string }) {
  return (
    <Box
      sx={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme =>
          theme.palette.mode === 'dark' ? 'rgba(25,118,210,0.25)' : '#e3edfb',
        color: theme => (theme.palette.mode === 'dark' ? '#90caf9' : '#1565c0'),
      }}
    >
      <Icon icon={icon} width={22} height={22} />
    </Box>
  );
}

function LearnMoreRow({ docsUrl }: { docsUrl: string }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
      <Link
        href={docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        variant="caption"
        underline="hover"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        Learn more <Icon icon="mdi:open-in-new" width={12} height={12} />
      </Link>
    </Box>
  );
}

export function ComponentCards({
  cnpgInstalled,
  certManagerInstalled,
  barmanInstalled,
  klioInstalled,
  loading,
  operatorNamespace,
}: {
  cnpgInstalled: boolean;
  certManagerInstalled: boolean;
  barmanInstalled: boolean;
  klioInstalled: boolean;
  loading: boolean;
  /** Actual namespace the operator pods run in — the plugins must live in the same one
   *  to work. Derived from the live pods, not from the namespaces created above
   *  (the operator may have been installed anywhere via the App Catalog). Null while
   *  the operator isn't installed or its pods haven't loaded. */
  operatorNamespace: string | null;
}) {
  const openAppCatalog = useOpenAppCatalog();
  // Barman Cloud requires both the operator and cert-manager (its chart issues TLS
  // certificates), so its install action stays disabled until those are satisfied.
  const barmanBlocked = !cnpgInstalled || !certManagerInstalled;
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const namespaceExists = (name: string): boolean | null =>
    namespaces === null ? null : namespaces.some(ns => ns.getName() === name);
  const customNamespacesFor = (createdFor: string, defaultName: string): string[] =>
    namespaces === null ? [] : getCustomCreatedNamespaces(namespaces, createdFor, defaultName);

  // All four cards stay on screen in the Installation tab with their install status
  // (Installed vs install action) — a stable inventory that mirrors the workflow steps
  // above, instead of cards vanishing as each component gets installed.
  // Both CNPG-I plugins must run in the operator's own namespace — derived from the
  // live operator pods, since the App Catalog lets the operator land in any namespace,
  // not just the ones created above.
  const sameNamespaceItem = operatorNamespace
    ? `Same namespace as the operator ("${operatorNamespace}") — select it when installing`
    : 'Same namespace as the operator — install the plugin where you installed the operator';

  return (
    <Box>
      <Typography variant="h6" component="h2">
        Components
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {cnpgInstalled && certManagerInstalled
          ? 'Install the optional backup plugins in just a few steps.'
          : 'Install the operator and optional backup plugins in just a few steps.'}
      </Typography>
      <Box
        display="grid"
        gap={2}
        sx={{
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, 1fr)',
            xl: 'repeat(4, 1fr)',
          },
        }}
      >
        {/* CloudNativePG operator */}
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <CardHeader
                icon={<CnpgLogo size={40} />}
                name="CloudNativePG"
                subtitle="Operator"
                installed={cnpgInstalled}
                checking={loading}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Installs the CloudNativePG operator to manage PostgreSQL clusters.
              </Typography>
              <Box
                sx={theme => ({
                  backgroundColor:
                    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : '#f5f8fc',
                  borderRadius: 1,
                  p: 1.5,
                  mt: 1.5,
                })}
              >
                <Typography variant="caption" fontWeight={700}>
                  What you&apos;ll get
                </Typography>
                <CheckList
                  items={[
                    'Create and manage PostgreSQL clusters',
                    'High availability and replication',
                    'Health and observability',
                  ]}
                />
              </Box>
              {!cnpgInstalled && (
                <PrereqList
                  items={[
                    'Kubernetes cluster with appropriate permissions',
                    'Dedicated namespace (cnpg-system)',
                  ]}
                  namespace={{ name: 'cnpg-system', exists: namespaceExists('cnpg-system') }}
                  createdFor={CNPG_CREATED_FOR}
                  customNamespaces={customNamespacesFor(CNPG_CREATED_FOR, 'cnpg-system')}
                />
              )}
              <Box sx={{ mt: 'auto', pt: 2 }}>
                {cnpgInstalled ? (
                  <Button
                    variant="outlined"
                    disabled
                    fullWidth
                    startIcon={<Icon icon="mdi:check" />}
                  >
                    Installed
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    fullWidth
                    startIcon={<Icon icon="mdi:cube-outline" />}
                    endIcon={<Icon icon="mdi:open-in-new" width={14} height={14} />}
                    onClick={() => openAppCatalog(CHARTS.cnpg)}
                  >
                    Install CloudNativePG
                  </Button>
                )}
                <LearnMoreRow docsUrl={DOC_URLS.cnpg} />
              </Box>
            </CardContent>
          </Card>

        {/* cert-manager */}
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <CardHeader
                icon={<CircleIcon icon="mdi:anchor" />}
                name="cert-manager"
                subtitle="TLS certificate management"
                installed={certManagerInstalled}
                checking={loading}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Required by CloudNativePG and some plugins to manage TLS certificates.
              </Typography>
              <Box
                sx={theme => ({
                  backgroundColor:
                    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : '#f5f8fc',
                  borderRadius: 1,
                  p: 1.5,
                  mt: 1.5,
                })}
              >
                <Typography variant="caption" fontWeight={700}>
                  What you&apos;ll get
                </Typography>
                <CheckList
                  items={[
                    'Automatic certificate issuance',
                    'Certificate renewal',
                    'Integration with Kubernetes',
                  ]}
                />
              </Box>
              {!certManagerInstalled && (
                <>
                  <PrereqList
                    items={[
                      'Helm (official chart)',
                      'Dedicated namespace (cert-manager)',
                      'Access to the App Catalog',
                    ]}
                    namespace={{ name: 'cert-manager', exists: namespaceExists('cert-manager') }}
                    createdFor={CERT_MANAGER_CREATED_FOR}
                    customNamespaces={customNamespacesFor(
                      CERT_MANAGER_CREATED_FOR,
                      'cert-manager'
                    )}
                  />
                  <RequiredValuesNote values={'crds:\n  enabled: true'} />
                </>
              )}
              <Box sx={{ mt: 'auto', pt: 2 }}>
                {certManagerInstalled ? (
                  <Button
                    variant="outlined"
                    disabled
                    fullWidth
                    startIcon={<Icon icon="mdi:check" />}
                  >
                    Installed
                  </Button>
                ) : (
                  <Tooltip title="Opens the official cert-manager chart in the Headlamp App Catalog (available in Headlamp Desktop).">
                    <Button
                      variant="outlined"
                      fullWidth
                      endIcon={<Icon icon="mdi:open-in-new" width={14} height={14} />}
                      onClick={() => openAppCatalog(CHARTS.certManager)}
                    >
                      Install via App Catalog
                    </Button>
                  </Tooltip>
                )}
                <LearnMoreRow docsUrl={DOC_URLS.certManager} />
              </Box>
            </CardContent>
          </Card>

        {/* Barman Cloud plugin */}
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <CardHeader
                icon={<CircleIcon icon="mdi:cloud-upload-outline" />}
                name="Barman Cloud"
                subtitle="Backup and recovery plugin"
                installed={barmanInstalled}
                checking={loading}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Integrates PostgreSQL backups with object storage using Barman Cloud.
              </Typography>
              <Box
                sx={theme => ({
                  backgroundColor:
                    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : '#f5f8fc',
                  borderRadius: 1,
                  p: 1.5,
                  mt: 1.5,
                })}
              >
                <Typography variant="caption" fontWeight={700}>
                  What you&apos;ll get
                </Typography>
                <CheckList
                  items={[
                    'Automated backups and retention',
                    'Restore from object storage',
                    'Backup monitoring and status',
                  ]}
                />
              </Box>
              {!barmanInstalled && (
                <PrereqList
                  items={[
                    'CloudNativePG installed',
                    'cert-manager installed',
                    sameNamespaceItem,
                  ]}
                />
              )}
              <Box sx={{ mt: 'auto', pt: 2 }}>
                {barmanInstalled ? (
                  <Button
                    variant="outlined"
                    disabled
                    fullWidth
                    startIcon={<Icon icon="mdi:check" />}
                  >
                    Installed
                  </Button>
                ) : (
                  <Tooltip
                    title={
                      barmanBlocked
                        ? 'Install CloudNativePG and cert-manager first — the Barman Cloud chart needs them to issue its TLS certificates.'
                        : operatorNamespace
                        ? `Opens the official Barman Cloud plugin chart in the Headlamp App Catalog. Install it into "${operatorNamespace}" — the same namespace as the operator.`
                        : 'Opens the official Barman Cloud plugin chart in the Headlamp App Catalog.'
                    }
                  >
                    {/* Tooltip needs a non-disabled wrapper to fire while the button is disabled. */}
                    <span>
                      <Button
                        variant="outlined"
                        fullWidth
                        disabled={barmanBlocked}
                        endIcon={<Icon icon="mdi:open-in-new" width={14} height={14} />}
                        onClick={() => openAppCatalog(CHARTS.barman)}
                      >
                        Install via App Catalog
                      </Button>
                    </span>
                  </Tooltip>
                )}
                <LearnMoreRow docsUrl={DOC_URLS.barman} />
              </Box>
            </CardContent>
          </Card>

        {/* Klio plugin (coming soon) */}
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <CardHeader
                icon={<CircleIcon icon="mdi:database" />}
                name="Klio"
                subtitle="Multi-tiered backup and recovery"
                installed={klioInstalled}
                checking={loading}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Klio provides advanced backup and recovery workflows with multi-tiered storage.
              </Typography>
              <Box
                sx={theme => ({
                  backgroundColor:
                    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : '#f5f8fc',
                  borderRadius: 1,
                  p: 1.5,
                  mt: 1.5,
                })}
              >
                <Typography variant="caption" fontWeight={700}>
                  What you&apos;ll get
                </Typography>
                <CheckList
                  items={[
                    'Multi-tiered backup strategies',
                    'Point-in-time recovery',
                    'Backup lifecycle management',
                  ]}
                />
              </Box>
              {!klioInstalled && (
                <PrereqList
                  items={[
                    'CloudNativePG installed',
                    'cert-manager installed',
                    sameNamespaceItem,
                  ]}
                />
              )}
              <Box sx={{ mt: 'auto', pt: 2 }}>
                {klioInstalled ? (
                  <Button
                    variant="outlined"
                    disabled
                    fullWidth
                    startIcon={<Icon icon="mdi:check" />}
                  >
                    Installed
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    disabled
                    fullWidth
                    endIcon={<Icon icon="mdi:open-in-new" width={14} height={14} />}
                  >
                    Coming soon
                  </Button>
                )}
                <LearnMoreRow docsUrl={DOC_URLS.klio} />
              </Box>
            </CardContent>
          </Card>
      </Box>
    </Box>
  );
}

function WorkflowStep({
  number,
  icon,
  title,
  description,
  completed,
  optional,
}: {
  number: number;
  icon: string;
  title: string;
  description: string;
  /** Required step done: green circle with check plus a disabled "Installed" marker.
   *  Optional steps keep their action affordance on the component cards below, so a
   *  completed optional step shows green but no button here. */
  completed?: boolean;
  /** Optional, open-ended steps (like backup plugins) can never be "done" — they render
   *  with an outlined badge and an "Optional" tag instead of todo-blue, so they don't nag
   *  like unfinished required steps. `completed` still wins when explicitly set. */
  optional?: boolean;
}) {
  const badgeBg = completed ? '#2e7d32' : optional ? 'transparent' : '#1565c0';
  const badgeFg = completed ? '#fff' : '#1565c0';
  const badgeBorder = !completed && optional ? '2px solid #1565c0' : 'none';
  const iconTone = completed ? '#2e7d32' : '#1565c0';
  return (
    <Box sx={{ flex: '1 1 180px', minWidth: 170, maxWidth: 260 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: badgeBg,
            color: badgeFg,
            border: badgeBorder,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {completed ? <Icon icon="mdi:check" width={18} height={18} /> : number}
        </Box>
        <Box sx={{ color: iconTone, display: 'flex' }}>
          <Icon icon={icon} width={28} height={28} />
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {title}
        </Typography>
        {optional && !completed && <Chip label="Optional" size="small" variant="outlined" />}
      </Box>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: completed && !optional ? 1 : 0 }}
      >
        {description}
      </Typography>
      {completed && !optional && (
        <Button variant="outlined" size="small" disabled startIcon={<Icon icon="mdi:check" />}>
          Installed
        </Button>
      )}
    </Box>
  );
}

export function InstallationWorkflow({
  cnpgInstalled = false,
  certManagerInstalled = false,
  barmanInstalled = false,
  klioInstalled = false,
}: {
  cnpgInstalled?: boolean;
  certManagerInstalled?: boolean;
  barmanInstalled?: boolean;
  klioInstalled?: boolean;
}) {
  // Both plugins on offer are backup plugins — "backup plugins" scopes the step to what
  // it actually covers. Any-of is the honest heuristic for optional: green once the user
  // has backup coverage. Actions live only on the component cards below (namespace
  // creation, values, blocked-state) — the workflow is a progress strip, not a launcher.
  const backupPluginInstalled = barmanInstalled || klioInstalled;

  return (
    <Box
      sx={theme => ({
        backgroundColor: theme.palette.mode === 'dark' ? 'rgba(25,118,210,0.08)' : '#f2f7fd',
        borderRadius: 2,
        p: 2.5,
      })}
    >
      <Typography variant="h6" component="h2">
        Installation workflow
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Follow the steps below to get your environment ready. Some components can be installed
        directly from Headlamp&apos;s App Catalog.
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 2,
          flexWrap: { xs: 'wrap', lg: 'nowrap' },
        }}
      >
        <WorkflowStep
          number={1}
          icon="mdi:elephant"
          title="Install CloudNativePG"
          description="Install the operator using the Headlamp App Catalog."
          completed={cnpgInstalled}
        />
        <Box sx={{ color: 'text.disabled', pt: 1, display: { xs: 'none', lg: 'block' } }}>
          <Icon icon="mdi:arrow-right" width={20} height={20} />
        </Box>
        <WorkflowStep
          number={2}
          icon="mdi:anchor"
          title="Install cert-manager"
          description="Open the Headlamp App Catalog and install the official cert-manager chart."
          completed={certManagerInstalled}
        />
        <Box sx={{ color: 'text.disabled', pt: 1, display: { xs: 'none', lg: 'block' } }}>
          <Icon icon="mdi:arrow-right" width={20} height={20} />
        </Box>
        <WorkflowStep
          number={3}
          icon="mdi:cloud-upload-outline"
          title="Install backup plugins"
          description="Pick a backup plugin (Barman Cloud or Klio). One is enough — both can coexist."
          optional
          completed={backupPluginInstalled}
        />
      </Box>
    </Box>
  );
}
