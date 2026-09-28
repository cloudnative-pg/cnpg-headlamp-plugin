import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Cluster } from '../../../resources/cluster';
import { ClusterImageCatalog, ImageCatalog } from '../../../resources/imageCatalog';
import { ObjectStore } from '../../../resources/objectStore';
import { VolumeSnapshotClass } from '../../../resources/volumeSnapshotClass';
import { AuthDisabledButton } from '../../common/AuthDisabledButton';
import { RequiredLabel } from '../../common/RequiredLabel';
import { StorageSizeClassFields } from '../../common/StorageSizeClassFields';
import { YamlPreview } from '../../common/YamlPreview';
import {
  BackupKind,
  buildClusterManifest,
  CatalogKind,
  ClusterCreateFormState,
  collectParameters,
  defaultFormState,
  deriveSummary,
  DryRunState,
  getValidationErrors,
  ImageSource,
  instanceCardSelection,
  KVRow,
  StartOption,
  SyncDataDurability,
  SyncMethod,
  TablespaceRow,
  validateDryRun,
} from './types';

const { createRouteURL } = Router;

const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

type CreateTab = 'general' | 'postgres' | 'ha' | 'storage' | 'backup' | 'yaml';

type UpdateFn = (patch: Partial<ClusterCreateFormState>) => void;

// Small labeled cylinder diagrams for the instance shortcut cards (primary vs sync
// standbys), per the wireframe — inline SVG with theme-derived colors so it stays
// legible in both light and dark mode, no icon font.
function InstanceDiagram({ kind }: { kind: 'single' | 'ha' | 'custom' }) {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const soft = theme.palette.action.hover;
  const paper = theme.palette.background.paper;
  const muted = theme.palette.text.secondary;
  const text = theme.palette.text.primary;

  if (kind === 'single') {
    return (
      <svg width="120" height="52" viewBox="0 0 120 52" role="img" aria-label="Single primary">
        <ellipse cx="60" cy="10" rx="18" ry="6" fill={primary} />
        <rect x="42" y="10" width="36" height="22" fill={soft} stroke={primary} />
        <ellipse cx="60" cy="32" rx="18" ry="6" fill={paper} stroke={primary} />
        <text x="60" y="48" fontSize="9" textAnchor="middle" fill={text}>
          Primary
        </text>
      </svg>
    );
  }
  if (kind === 'ha') {
    return (
      <svg
        width="120"
        height="52"
        viewBox="0 0 120 52"
        role="img"
        aria-label="Primary and sync standbys"
      >
        <g>
          <ellipse cx="24" cy="10" rx="13" ry="5" fill={primary} />
          <rect x="11" y="10" width="26" height="16" fill={soft} stroke={primary} />
          <ellipse cx="24" cy="26" rx="13" ry="5" fill={paper} stroke={primary} />
          <text x="24" y="40" fontSize="8" textAnchor="middle" fill={text}>
            Primary
          </text>
        </g>
        <g>
          <ellipse cx="60" cy="10" rx="13" ry="5" fill={muted} />
          <rect x="47" y="10" width="26" height="16" fill={paper} stroke={muted} />
          <ellipse cx="60" cy="26" rx="13" ry="5" fill={paper} stroke={muted} />
          <text x="60" y="40" fontSize="8" textAnchor="middle" fill={text}>
            Sync
          </text>
        </g>
        <g>
          <ellipse cx="96" cy="10" rx="13" ry="5" fill={muted} />
          <rect x="83" y="10" width="26" height="16" fill={paper} stroke={muted} />
          <ellipse cx="96" cy="26" rx="13" ry="5" fill={paper} stroke={muted} />
          <text x="96" y="40" fontSize="8" textAnchor="middle" fill={text}>
            Sync
          </text>
        </g>
      </svg>
    );
  }
  return (
    <svg width="120" height="52" viewBox="0 0 120 52" role="img" aria-label="Custom count">
      <rect
        x="14"
        y="8"
        width="24"
        height="20"
        rx="4"
        fill="none"
        stroke={muted}
        strokeDasharray="3 2"
      />
      <rect
        x="44"
        y="8"
        width="24"
        height="20"
        rx="4"
        fill="none"
        stroke={muted}
        strokeDasharray="3 2"
      />
      <text x="86" y="23" fontSize="13" fill={muted}>
        + N
      </text>
      <text x="60" y="44" fontSize="9" textAnchor="middle" fill={muted}>
        Count set in HA tab
      </text>
    </svg>
  );
}

function KVEditor({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  return (
    <>
      {rows.map(row => (
        <Box key={row.id} sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            label="Key"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={e =>
              onChange(rows.map(r => (r.id === row.id ? { ...r, key: e.target.value } : r)))
            }
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label="Value"
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={e =>
              onChange(rows.map(r => (r.id === row.id ? { ...r, value: e.target.value } : r)))
            }
            sx={{ flex: 1 }}
          />
          <Button
            size="small"
            onClick={() => onChange(rows.filter(r => r.id !== row.id))}
            aria-label="Remove parameter"
          >
            Remove
          </Button>
        </Box>
      ))}
    </>
  );
}

interface TabProps {
  state: ClusterCreateFormState;
  update: UpdateFn;
  newRowId: () => string;
}

function GeneralTab({
  state,
  update,
  newRowId,
  goToTab,
}: TabProps & { goToTab: (tab: CreateTab) => void }) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const [objectStores] = ObjectStore.useList({ namespace: state.namespace });
  const selection = instanceCardSelection(state.instances);
  const nameInvalid = !!state.name && !NAME_PATTERN.test(state.name);

  // Selected card reads as gray in both light and dark mode (action.selected
  // resolves to a theme-appropriate gray), never the solid primary fill.
  const cardSx = (selected: boolean) => ({
    flex: 1,
    flexDirection: 'column' as const,
    alignItems: 'flex-start' as const,
    py: 1.5,
    color: 'text.primary',
    borderWidth: selected ? 2 : 1,
    ...(selected
      ? {
          backgroundColor: 'action.selected',
          borderColor: 'text.secondary',
        }
      : {}),
  });

  return (
    <>
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Cluster identity">
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            fullWidth
            margin="normal"
            label={<RequiredLabel label="Name" required />}
            value={state.name}
            onChange={e => update({ name: e.target.value })}
            error={nameInvalid}
            helperText={
              nameInvalid
                ? 'Lowercase letters, numbers and hyphens only.'
                : 'Lowercase letters, numbers and hyphens only.'
            }
            sx={{ flex: 1, minWidth: 200 }}
          />
          <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 200 }}>
            <InputLabel id="create-cluster-namespace-label">
              <RequiredLabel label="Namespace" required />
            </InputLabel>
            <Select
              labelId="create-cluster-namespace-label"
              label={<RequiredLabel label="Namespace" required />}
              value={state.namespace}
              onChange={e => update({ namespace: e.target.value })}
            >
              {(namespaces ?? []).map(ns => (
                <MenuItem key={ns.getName()} value={ns.getName()}>
                  {ns.getName()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Instances">
        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            onClick={() => update({ instances: 1 })}
            sx={cardSx(selection === '1')}
          >
            <InstanceDiagram kind="single" />
            <strong>1 — Development</strong>
            <Typography variant="caption" color="text.secondary">
              Single writable instance
            </Typography>
          </Button>
          <Button
            variant="outlined"
            onClick={() => update({ instances: 3 })}
            sx={cardSx(selection === '3')}
          >
            <InstanceDiagram kind="ha" />
            <strong>3 — Production HA</strong>
            <Typography variant="caption" color="text.secondary">
              Primary + 2 standbys, auto-failover
            </Typography>
          </Button>
          <Button
            variant="outlined"
            onClick={() => goToTab('ha')}
            sx={cardSx(selection === 'custom')}
          >
            <InstanceDiagram kind="custom" />
            <strong>Custom ({state.instances})</strong>
            <Typography variant="caption" color="text.secondary">
              Any count, e.g. 2 or 5
            </Typography>
          </Button>
        </Box>
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Start from...">
        <FormControl fullWidth margin="normal">
          <Select
            aria-label="Start from"
            value={state.startOption === 'empty' ? 'empty' : 'recovery'}
            onChange={e =>
              update({
                startOption: e.target.value === 'empty' ? 'empty' : 'barman-recovery',
              })
            }
          >
            <MenuItem value="empty">Empty database — fresh data directory (initdb)</MenuItem>
            <MenuItem value="recovery">
              Restore from existing data — via plugin recovery (bootstrap.recovery)
            </MenuItem>
          </Select>
        </FormControl>

        {state.startOption !== 'empty' && (
          <>
            <FormControl fullWidth margin="normal">
              <InputLabel id="create-cluster-recovery-source-label">Recovery source</InputLabel>
              <Select
                labelId="create-cluster-recovery-source-label"
                label="Recovery source"
                value={state.startOption}
                onChange={e => update({ startOption: e.target.value as StartOption })}
              >
                <MenuItem value="barman-recovery">
                  Barman Cloud plugin — ObjectStore + server
                </MenuItem>
                <MenuItem value="custom-recovery">
                  Custom plugin — any CNPG plugin, free-form name + parameters
                </MenuItem>
              </Select>
            </FormControl>

            {state.startOption === 'barman-recovery' && (
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 200 }}>
                  <InputLabel id="create-cluster-recovery-objectstore-label">
                    <RequiredLabel label="Recovery ObjectStore" required />
                  </InputLabel>
                  <Select
                    labelId="create-cluster-recovery-objectstore-label"
                    label={<RequiredLabel label="Recovery ObjectStore" required />}
                    value={state.recoveryObjectStoreName}
                    onChange={e => update({ recoveryObjectStoreName: e.target.value })}
                  >
                    {(objectStores ?? []).map(os => (
                      <MenuItem key={os.getName()} value={os.getName()}>
                        {os.getName()}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  margin="normal"
                  label={<RequiredLabel label="Source server" required />}
                  placeholder={state.name || 'old-cluster'}
                  value={state.recoveryServerName}
                  onChange={e => update({ recoveryServerName: e.target.value })}
                  sx={{ flex: 1, minWidth: 200 }}
                />
              </Box>
            )}

            {state.startOption === 'custom-recovery' && (
              <>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <TextField
                    fullWidth
                    margin="normal"
                    label={<RequiredLabel label="External cluster name" required />}
                    value={state.recoveryExternalClusterName}
                    onChange={e => update({ recoveryExternalClusterName: e.target.value })}
                    sx={{ flex: 1, minWidth: 200 }}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label={<RequiredLabel label="Plugin name" required />}
                    placeholder="e.g. barman-cloud.cloudnative-pg.io"
                    value={state.recoveryPluginName}
                    onChange={e => update({ recoveryPluginName: e.target.value })}
                    sx={{ flex: 1, minWidth: 200 }}
                  />
                </Box>
                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  Plugin parameters
                </Typography>
                <KVEditor
                  rows={state.recoveryPluginParams}
                  onChange={rows => update({ recoveryPluginParams: rows })}
                  keyPlaceholder="key, e.g. barmanObjectName"
                  valuePlaceholder="value"
                />
                <Button
                  variant="outlined"
                  size="small"
                  sx={{ mt: 1 }}
                  onClick={() =>
                    update({
                      recoveryPluginParams: [
                        ...state.recoveryPluginParams,
                        { id: newRowId(), key: '', value: '' },
                      ],
                    })
                  }
                >
                  Add parameter
                </Button>
              </>
            )}
          </>
        )}
      </SectionBox>
    </>
  );
}

function PostgresTab({ state, update, newRowId }: TabProps) {
  const [imageCatalogs] = ImageCatalog.useList({ namespace: state.namespace });
  const [clusterImageCatalogs] = ClusterImageCatalog.useList();
  const choices = state.imageCatalogKind === 'ImageCatalog' ? imageCatalogs : clusterImageCatalogs;
  const selected = choices?.find(c => c.getName() === state.imageCatalogName);

  return (
    <>
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="PostgreSQL image">
        <FormControl fullWidth margin="normal">
          <InputLabel id="create-cluster-imagesource-label">Image source</InputLabel>
          <Select
            labelId="create-cluster-imagesource-label"
            label="Image source"
            value={state.imageSource}
            onChange={e => update({ imageSource: e.target.value as ImageSource })}
          >
            <MenuItem value="default">Operator default — follows operator upgrades</MenuItem>
            <MenuItem value="catalog">ImageCatalog — pin major, float minor</MenuItem>
            <MenuItem value="imageName">Custom image — full imageName pin</MenuItem>
          </Select>
        </FormControl>

        {state.imageSource === 'catalog' && (
          <>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 200 }}>
                <InputLabel id="create-cluster-imagecatalogkind-label">
                  <RequiredLabel label="Catalog Kind" required />
                </InputLabel>
                <Select
                  labelId="create-cluster-imagecatalogkind-label"
                  label={<RequiredLabel label="Catalog Kind" required />}
                  value={state.imageCatalogKind}
                  onChange={e =>
                    update({
                      imageCatalogKind: e.target.value as CatalogKind,
                      imageCatalogName: '',
                      imageCatalogMajor: '',
                    })
                  }
                >
                  <MenuItem value="ClusterImageCatalog">
                    ClusterImageCatalog (cluster-wide)
                  </MenuItem>
                  <MenuItem value="ImageCatalog">ImageCatalog (this namespace)</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 200 }}>
                <InputLabel id="create-cluster-imagecatalogname-label">
                  <RequiredLabel label="Catalog" required />
                </InputLabel>
                <Select
                  labelId="create-cluster-imagecatalogname-label"
                  label={<RequiredLabel label="Catalog" required />}
                  value={state.imageCatalogName}
                  onChange={e =>
                    update({ imageCatalogName: e.target.value, imageCatalogMajor: '' })
                  }
                >
                  {(choices ?? []).map(c => (
                    <MenuItem key={c.getName()} value={c.getName()}>
                      {c.getName()}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <FormControl fullWidth margin="normal">
              <InputLabel id="create-cluster-imagecatalogmajor-label">
                <RequiredLabel label="Major" required />
              </InputLabel>
              <Select
                labelId="create-cluster-imagecatalogmajor-label"
                label={<RequiredLabel label="Major" required />}
                value={state.imageCatalogMajor}
                disabled={!selected}
                onChange={e => update({ imageCatalogMajor: e.target.value })}
              >
                {(selected?.images ?? []).map(entry => (
                  <MenuItem key={entry.major} value={String(entry.major)}>
                    {entry.major} ({entry.image})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </>
        )}

        {state.imageSource === 'imageName' && (
          <TextField
            fullWidth
            margin="normal"
            label={<RequiredLabel label="Image name" required />}
            placeholder="ghcr.io/cloudnative-pg/postgresql:17.6"
            value={state.imageName}
            onChange={e => update({ imageName: e.target.value })}
          />
        )}
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="PostgreSQL configuration">
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            margin="normal"
            label="max_connections"
            placeholder="e.g. 200"
            helperText="Default ~100. Increase for many app connections; costs memory."
            value={state.paramMaxConnections}
            onChange={e => update({ paramMaxConnections: e.target.value })}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <TextField
            margin="normal"
            label="shared_buffers"
            placeholder="e.g. 256MB"
            helperText="Default 128MB. Common tune: 25% of memory."
            value={state.paramSharedBuffers}
            onChange={e => update({ paramSharedBuffers: e.target.value })}
            sx={{ flex: 1, minWidth: 200 }}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            margin="normal"
            label="max_wal_size"
            placeholder="e.g. 1GB"
            helperText="Default 1GB. Increase on write-heavy workloads to checkpoint less often."
            value={state.paramMaxWalSize}
            onChange={e => update({ paramMaxWalSize: e.target.value })}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <TextField
            margin="normal"
            label="checkpoint_timeout"
            placeholder="e.g. 15min"
            value={state.paramCheckpointTimeout}
            onChange={e => update({ paramCheckpointTimeout: e.target.value })}
            sx={{ flex: 1, minWidth: 200 }}
          />
        </Box>
        <Typography variant="subtitle2" sx={{ mt: 2 }}>
          Other parameters
        </Typography>
        <KVEditor
          rows={state.extraParams}
          onChange={rows => update({ extraParams: rows })}
          keyPlaceholder="key, e.g. log_min_duration_statement"
          valuePlaceholder="value"
        />
        <Button
          variant="outlined"
          size="small"
          sx={{ mt: 1 }}
          onClick={() =>
            update({
              extraParams: [...state.extraParams, { id: newRowId(), key: '', value: '' }],
            })
          }
        >
          Add parameter
        </Button>
      </SectionBox>
    </>
  );
}

function HATab({ state, update }: TabProps) {
  const singleInstance = state.instances <= 1;
  return (
    <>
      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Instances">
        <TextField
          fullWidth
          margin="normal"
          label={<RequiredLabel label="Number of instances" required />}
          type="number"
          inputProps={{ min: 1 }}
          value={state.instances}
          onChange={e => update({ instances: Number(e.target.value) || 1 })}
        />
      </SectionBox>

      <SectionBox headerProps={{ headerStyle: 'normal' }} title="Synchronous replication">
        <FormControlLabel
          sx={{ mt: 2 }}
          control={
            <Checkbox
              checked={state.syncEnabled && !singleInstance}
              disabled={singleInstance}
              onChange={e => update({ syncEnabled: e.target.checked })}
            />
          }
          label={
            singleInstance
              ? 'Enable synchronous replication (needs at least 2 instances)'
              : 'Enable synchronous replication'
          }
        />
        {state.syncEnabled && !singleInstance && (
          <>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 160 }}>
                <InputLabel id="create-cluster-syncmethod-label">Method</InputLabel>
                <Select
                  labelId="create-cluster-syncmethod-label"
                  label="Method"
                  value={state.syncMethod}
                  onChange={e => update({ syncMethod: e.target.value as SyncMethod })}
                >
                  <MenuItem value="any">any</MenuItem>
                  <MenuItem value="first">first</MenuItem>
                </Select>
              </FormControl>
              <TextField
                margin="normal"
                label="Number"
                type="number"
                inputProps={{ min: 1 }}
                value={state.syncNumber}
                onChange={e => update({ syncNumber: e.target.value })}
                sx={{ flex: 1, minWidth: 160 }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 160 }}>
                <InputLabel id="create-cluster-syncdurability-label">Data durability</InputLabel>
                <Select
                  labelId="create-cluster-syncdurability-label"
                  label="Data durability"
                  value={state.syncDataDurability}
                  onChange={e =>
                    update({ syncDataDurability: e.target.value as SyncDataDurability })
                  }
                >
                  <MenuItem value="required">required</MenuItem>
                  <MenuItem value="preferred">preferred</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </>
        )}
      </SectionBox>
    </>
  );
}

function StorageTab({ state, update, newRowId }: TabProps) {
  function addTablespace() {
    update({
      tablespaces: [
        ...state.tablespaces,
        { id: newRowId(), name: '', storage: { size: '1Gi' }, temporary: false },
      ],
    });
  }

  function updateTablespace(id: string, changes: Partial<TablespaceRow>) {
    update({
      tablespaces: state.tablespaces.map(t => (t.id === id ? { ...t, ...changes } : t)),
    });
  }

  return (
    <SectionBox headerProps={{ headerStyle: 'normal' }} title="Storage">
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <Box
          sx={{ flex: 1, minWidth: 220, border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
        >
          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            <RequiredLabel label="PGData" required />
          </Typography>
          <StorageSizeClassFields
            idPrefix="create-cluster-pgdata"
            sizeLabel="PGData Size"
            sizeRequired={false}
            value={state.storage}
            onChange={storage => update({ storage })}
          />
        </Box>
        <Box
          sx={{ flex: 1, minWidth: 220, border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={state.useWalStorage}
                onChange={e => update({ useWalStorage: e.target.checked })}
              />
            }
            label="Separate WAL storage"
          />
          {state.useWalStorage && (
            <StorageSizeClassFields
              idPrefix="create-cluster-walstorage"
              sizeLabel="WAL Storage Size"
              value={state.walStorage}
              onChange={walStorage => update({ walStorage })}
            />
          )}
        </Box>
      </Box>

      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Tablespaces
      </Typography>
      {state.tablespaces.map(t => (
        <Box
          key={t.id}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, mt: 1, mb: 1 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              fullWidth
              margin="normal"
              label={<RequiredLabel label="Tablespace Name" required />}
              value={t.name}
              onChange={e => updateTablespace(t.id, { name: e.target.value })}
            />
            <Button
              onClick={() => update({ tablespaces: state.tablespaces.filter(x => x.id !== t.id) })}
            >
              Remove
            </Button>
          </Box>
          <StorageSizeClassFields
            idPrefix={`create-cluster-tablespace-${t.id}`}
            value={t.storage}
            onChange={storage => updateTablespace(t.id, { storage })}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={t.temporary}
                onChange={e => updateTablespace(t.id, { temporary: e.target.checked })}
              />
            }
            label="Temporary tablespace (used for temp_tablespaces)"
          />
        </Box>
      ))}
      <Button variant="outlined" size="small" onClick={addTablespace} sx={{ mt: 1 }}>
        Add tablespace
      </Button>
    </SectionBox>
  );
}

function BackupTab({ state, update, newRowId }: TabProps) {
  const [objectStores] = ObjectStore.useList({ namespace: state.namespace });
  const [snapshotClasses] = VolumeSnapshotClass.useList();

  return (
    <SectionBox headerProps={{ headerStyle: 'normal' }} title="Backup">
      <FormControlLabel
        sx={{ mt: 2 }}
        control={
          <Checkbox
            checked={state.backupEnabled}
            onChange={e => {
              update({ backupEnabled: e.target.checked });
              if (!e.target.checked) {
                update({ volumeSnapshotEnabled: false });
              }
            }}
          />
        }
        label="Enable backups"
      />
      {state.backupEnabled && (
        <>
          <FormControl fullWidth margin="normal">
            <InputLabel id="create-cluster-backupkind-label">Backup method</InputLabel>
            <Select
              labelId="create-cluster-backupkind-label"
              label="Backup method"
              value={state.backupKind}
              onChange={e => update({ backupKind: e.target.value as BackupKind })}
            >
              <MenuItem value="barman">Barman Cloud plugin — ObjectStore + server</MenuItem>
              <MenuItem value="custom">Custom CNPG-I plugin — free-form name + parameters</MenuItem>
            </Select>
          </FormControl>

          {state.backupKind === 'barman' && (
            <>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <FormControl fullWidth margin="normal" sx={{ flex: 1, minWidth: 200 }}>
                  <InputLabel id="create-cluster-backup-objectstore-label">
                    <RequiredLabel label="ObjectStore" required />
                  </InputLabel>
                  <Select
                    labelId="create-cluster-backup-objectstore-label"
                    label={<RequiredLabel label="ObjectStore" required />}
                    value={state.backupObjectStoreName}
                    onChange={e => update({ backupObjectStoreName: e.target.value })}
                  >
                    {(objectStores ?? []).map(os => (
                      <MenuItem key={os.getName()} value={os.getName()}>
                        {os.getName()}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  margin="normal"
                  label="Server name"
                  placeholder={state.name || 'cluster-example'}
                  helperText="Filed under in the object store. Defaults to this cluster's name if left empty."
                  value={state.backupServerName}
                  onChange={e => update({ backupServerName: e.target.value })}
                  sx={{ flex: 1, minWidth: 200 }}
                />
              </Box>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={state.volumeSnapshotEnabled}
                    onChange={e => update({ volumeSnapshotEnabled: e.target.checked })}
                  />
                }
                label="Enable volume-snapshot backups (needs WAL archiving above)"
              />
              {state.volumeSnapshotEnabled && (
                <FormControl fullWidth margin="normal">
                  <InputLabel id="create-cluster-volumesnapshotclass-label">
                    <RequiredLabel label="Volume Snapshot Class" required />
                  </InputLabel>
                  <Select
                    labelId="create-cluster-volumesnapshotclass-label"
                    label={<RequiredLabel label="Volume Snapshot Class" required />}
                    value={state.volumeSnapshotClassName}
                    onChange={e => update({ volumeSnapshotClassName: e.target.value })}
                  >
                    {(snapshotClasses ?? []).map(vsc => (
                      <MenuItem key={vsc.getName()} value={vsc.getName()}>
                        {vsc.getName()}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </>
          )}

          {state.backupKind === 'custom' && (
            <>
              <TextField
                fullWidth
                margin="normal"
                label={<RequiredLabel label="Plugin name" required />}
                placeholder="e.g. my-backup.cnpg.io"
                value={state.backupPluginName}
                onChange={e => update({ backupPluginName: e.target.value })}
              />
              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Parameters
              </Typography>
              <KVEditor
                rows={state.backupPluginParams}
                onChange={rows => update({ backupPluginParams: rows })}
                keyPlaceholder="key"
                valuePlaceholder="value"
              />
              <Button
                variant="outlined"
                size="small"
                sx={{ mt: 1 }}
                onClick={() =>
                  update({
                    backupPluginParams: [
                      ...state.backupPluginParams,
                      { id: newRowId(), key: '', value: '' },
                    ],
                  })
                }
              >
                Add parameter
              </Button>
              <FormControlLabel
                sx={{ display: 'flex', mt: 1 }}
                control={
                  <Checkbox
                    checked={state.backupIsWalArchiver}
                    onChange={e => update({ backupIsWalArchiver: e.target.checked })}
                  />
                }
                label="isWALArchiver"
              />
            </>
          )}
        </>
      )}
    </SectionBox>
  );
}

export function CreateClusterPage() {
  const history = useHistory();
  const [tab, setTab] = useState<CreateTab>('general');
  const [state, setState] = useState<ClusterCreateFormState>(defaultFormState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manifestOverride, setManifestOverride] = useState<object | null>(null);
  const [dryRun, setDryRun] = useState<DryRunState>({ status: 'idle' });
  const [dryRunValidating, setDryRunValidating] = useState(false);

  const rowIdCounter = useRef(0);
  const imageAutoSelected = useRef(false);

  const [imageCatalogs] = ImageCatalog.useList({ namespace: state.namespace });
  const [clusterImageCatalogs] = ClusterImageCatalog.useList();
  const hasCatalogs = (imageCatalogs?.length ?? 0) + (clusterImageCatalogs?.length ?? 0) > 0;

  // Pre-select the catalog image source when catalogs exist, per the plan. Runs
  // once so it never overrides an explicit user choice afterwards.
  useEffect(() => {
    if (!imageAutoSelected.current && hasCatalogs && state.imageSource === 'default') {
      imageAutoSelected.current = true;
      setState(prev =>
        prev.imageSource === 'default' ? { ...prev, imageSource: 'catalog' } : prev
      );
    }
    if (!imageAutoSelected.current && (imageCatalogs !== null || clusterImageCatalogs !== null)) {
      imageAutoSelected.current = true;
    }
  }, [hasCatalogs, state.imageSource, imageCatalogs, clusterImageCatalogs]);

  function update(patch: Partial<ClusterCreateFormState>) {
    setState(prev => ({ ...prev, ...patch }));
  }

  function newRowId(): string {
    rowIdCounter.current += 1;
    return `row-${rowIdCounter.current}`;
  }

  const manifest = useMemo(() => buildClusterManifest(state), [state]);
  const summary = useMemo(() => deriveSummary(state), [state]);
  const errors = useMemo(() => getValidationErrors(state), [state]);
  const paramsEmpty = useMemo(() => Object.keys(collectParameters(state)).length === 0, [state]);
  const canSubmit = errors.length === 0 && !submitting;

  async function handleValidate() {
    setDryRunValidating(true);
    setDryRun({ status: 'validating' });
    const result = await validateDryRun(manifestOverride ?? manifest, (body, queryParams) =>
      Cluster.apiEndpoint.post(body, queryParams)
    );
    setDryRun(result);
    setDryRunValidating(false);
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await Cluster.apiEndpoint.post(manifestOverride ?? manifest);
      history.push(
        createRouteURL('CNPG Cluster', { namespace: state.namespace, name: state.name })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cluster');
      setSubmitting(false);
    }
  }

  function handleCancel() {
    history.push(createRouteURL('CNPG Clusters'));
  }

  const tabProps: TabProps = { state, update, newRowId };

  return (
    <Box
      sx={{
        maxWidth: 1280,
        mx: 'auto',
        pb: 2,
        pt: 2,
        // Halve the gap between each section title and its content (Headlamp's
        // SectionHeader pads all around by default). Scoped to this page, whose
        // only Grid containers are those headers.
        '& .MuiGrid-container': { paddingBottom: 1 },
      }}
    >
      <Typography variant="h1" component="h1" sx={{ mb: 2 }}>
        Create / Restore Cluster
      </Typography>

      <Box
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, next: CreateTab) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="general" label="General" />
          <Tab value="postgres" label="PostgreSQL" />
          <Tab value="ha" label="High Availability" />
          <Tab value="storage" label="Storage" />
          <Tab value="backup" label="Backup" />
          <Tab value="yaml" label="YAML Preview" sx={{ fontWeight: 700 }} />
        </Tabs>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: '1fr 340px' },
          alignItems: 'start',
          mt: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {tab === 'general' && <GeneralTab {...tabProps} goToTab={setTab} />}
          {tab === 'postgres' && <PostgresTab {...tabProps} />}
          {tab === 'ha' && <HATab {...tabProps} />}
          {tab === 'storage' && <StorageTab {...tabProps} />}
          {tab === 'backup' && <BackupTab {...tabProps} />}
          {tab === 'yaml' && (
            <SectionBox headerProps={{ headerStyle: 'normal' }} title="YAML Preview">
              <YamlPreview
                manifest={manifest}
                onOverrideChange={setManifestOverride}
                defaultExpanded
              />
            </SectionBox>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </Box>

        <SectionBox
          headerProps={{ headerStyle: 'normal' }}
          title="Summary"
          sx={{ position: { lg: 'sticky' }, top: { lg: 16 } }}
        >
          <Box
            component="dl"
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              rowGap: 1,
              columnGap: 2,
              m: 0,
              fontSize: 13,
            }}
          >
            {(
              [
                ['Name', summary.name],
                ['Image', summary.image],
                ['Instances', summary.instances],
                ['Replication', summary.replication],
                ['Storage', summary.storage],
                ['Backup', summary.backup],
                ['Start', summary.start],
                ['Parameters', summary.parameters],
              ] as [string, string][]
            ).map(([term, value]) => (
              <Box key={term} sx={{ display: 'contents' }}>
                <Typography component="dt" variant="body2" color="text.secondary">
                  {term}
                </Typography>
                <Typography
                  component="dd"
                  variant="body2"
                  sx={{ m: 0, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}
                >
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
          {paramsEmpty && (
            <Alert severity="info" sx={{ mt: 2 }}>
              No PostgreSQL parameters set — operator defaults will apply.
            </Alert>
          )}
          {dryRun.status === 'idle' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Not validated yet — form checks only. Dry-run is on demand.
            </Alert>
          )}
          {dryRun.status === 'validating' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Validating via dry-run…
            </Alert>
          )}
          {dryRun.status === 'passed' && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Dry-run passed.
            </Alert>
          )}
          {dryRun.status === 'failed' && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Dry-run failed: {dryRun.errors.join('; ')}
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              disabled={dryRunValidating}
              onClick={handleValidate}
            >
              Validate via dry-run
            </Button>
            <Button variant="outlined" size="small" onClick={handleCancel}>
              Cancel
            </Button>
            <AuthDisabledButton
              item={Cluster}
              authVerb="create"
              deniedMessage="You don't have permission to create Clusters."
            >
              <Button
                variant="contained"
                color="primary"
                size="small"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {state.startOption === 'empty' ? 'Create cluster' : 'Restore cluster'}
              </Button>
            </AuthDisabledButton>
          </Box>
        </SectionBox>
      </Box>
    </Box>
  );
}

export function getClusterCreateUrl(): string {
  return createRouteURL('CNPG Cluster New');
}
