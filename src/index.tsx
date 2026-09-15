/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { BackupDetail } from './components/backups/Detail';
import { BackupsList } from './components/backups/List';
import { ClusterImageCatalogDetail } from './components/clusterimagecatalogs/Detail';
import { ClusterImageCatalogsList } from './components/clusterimagecatalogs/List';
import { ClusterDetail } from './components/clusters/Detail';
import { ClustersList } from './components/clusters/List';
import { PodLogsPage } from './components/common/podLogs';
import { PodTerminalPage } from './components/common/podTerminal';
import { DatabaseRoleDetail } from './components/databaseroles/Detail';
import { DatabaseRolesList } from './components/databaseroles/List';
import { DatabaseDetail } from './components/databases/Detail';
import { DatabasesList } from './components/databases/List';
import { ImageCatalogDetail } from './components/imagecatalogs/Detail';
import { ImageCatalogsList } from './components/imagecatalogs/List';
import { ObjectStoreDetail } from './components/objectstores/Detail';
import { ObjectStoresList } from './components/objectstores/List';
import { PoolerDetail } from './components/poolers/Detail';
import { PoolersList } from './components/poolers/List';
import { PublicationDetail } from './components/publications/Detail';
import { PublicationsList } from './components/publications/List';
import { ScheduledBackupDetail } from './components/scheduledbackups/Detail';
import { ScheduledBackupsList } from './components/scheduledbackups/List';
import { OperatorStatus } from './components/status/OperatorStatus';
import { SubscriptionDetail } from './components/subscriptions/Detail';
import { SubscriptionsList } from './components/subscriptions/List';

// Sidebar entry "name"s share one global namespace with Headlamp's own entries and every other
// installed plugin — the same hazard as route names below. Bare 'Clusters'/'Backups'/'Status'
// would be prime collision candidates, so every entry is prefixed. These names are internal
// wiring only (the visible text is `label`), and each entry sets an explicit `url`, so nothing
// falls back to resolving a route by entry name.
registerSidebarEntry({
  name: 'cnpg-root',
  // Points at the operator/plugin status overview rather than straight at the cluster list, so
  // clicking the top-level sidebar entry answers "is CNPG even installed correctly?" first.
  url: '/cnpg/status',
  icon: 'mdi:database',
  parent: '',
  label: 'CloudNativePG',
});

registerSidebarEntry({
  name: 'cnpg-status',
  url: '/cnpg/status',
  parent: 'cnpg-root',
  label: 'Status',
});

registerSidebarEntry({
  name: 'cnpg-clusters-group',
  // See the equivalent comment on ImageCatalogsGroup below: without an explicit url this group
  // link would resolve to nothing (its name/first-child-name isn't a registered route name) and
  // never expand, so it's pointed straight at the first child's page instead.
  url: '/cnpg/clusters',
  parent: 'cnpg-root',
  label: 'Postgres Clusters',
});

registerSidebarEntry({
  name: 'cnpg-clusters',
  url: '/cnpg/clusters',
  parent: 'cnpg-clusters-group',
  label: 'Clusters',
});

registerSidebarEntry({
  name: 'cnpg-databases',
  url: '/cnpg/databases',
  parent: 'cnpg-clusters-group',
  label: 'Databases',
});

registerSidebarEntry({
  name: 'cnpg-database-roles',
  url: '/cnpg/databaseroles',
  parent: 'cnpg-clusters-group',
  label: 'Roles',
});

registerSidebarEntry({
  name: 'cnpg-publications',
  url: '/cnpg/publications',
  parent: 'cnpg-clusters-group',
  label: 'Publications',
});

registerSidebarEntry({
  name: 'cnpg-subscriptions',
  url: '/cnpg/subscriptions',
  parent: 'cnpg-clusters-group',
  label: 'Subscriptions',
});

registerSidebarEntry({
  name: 'cnpg-poolers',
  url: '/cnpg/poolers',
  parent: 'cnpg-root',
  label: 'Poolers',
});

registerSidebarEntry({
  name: 'cnpg-backups-group',
  // See the equivalent comment on ImageCatalogsGroup below: without an explicit url this group
  // link would resolve to nothing (its name/first-child-name isn't a registered route name) and
  // never expand, so it's pointed straight at the first child's page instead.
  url: '/cnpg/backups',
  parent: 'cnpg-root',
  label: 'Backups',
});

registerSidebarEntry({
  name: 'cnpg-backups',
  url: '/cnpg/backups',
  parent: 'cnpg-backups-group',
  label: 'Backups',
});

registerSidebarEntry({
  name: 'cnpg-scheduled-backups',
  url: '/cnpg/scheduledbackups',
  parent: 'cnpg-backups-group',
  label: 'Scheduled Backups',
});

registerSidebarEntry({
  name: 'cnpg-object-stores',
  url: '/cnpg/objectstores',
  parent: 'cnpg-backups-group',
  label: 'Object Stores',
});

registerSidebarEntry({
  name: 'cnpg-image-catalogs-group',
  // Without an explicit url, Headlamp's SidebarItem falls back to resolving a route named after
  // this entry (or its first child's sidebar-entry name), not the actual registered route name —
  // and our routes are deliberately prefixed (e.g. 'CNPG Image Catalogs', see CLAUDE.md) to dodge
  // naming collisions, so that fallback resolves to nothing and the group becomes an inert link
  // that never expands. Pointing it straight at the first child's page, like the top-level
  // 'CloudNativePG' entry does, fixes both problems at once.
  url: '/cnpg/imagecatalogs',
  parent: 'cnpg-root',
  label: 'Image Catalogs',
});

registerSidebarEntry({
  name: 'cnpg-image-catalogs',
  url: '/cnpg/imagecatalogs',
  parent: 'cnpg-image-catalogs-group',
  label: 'ImageCatalogs',
});

registerSidebarEntry({
  name: 'cnpg-cluster-image-catalogs',
  url: '/cnpg/clusterimagecatalogs',
  parent: 'cnpg-image-catalogs-group',
  label: 'ClusterImageCatalogs',
});

registerRoute({
  path: '/cnpg/status',
  sidebar: 'cnpg-status',
  name: 'CNPG Status',
  exact: true,
  component: () => <OperatorStatus />,
});

registerRoute({
  path: '/cnpg/clusters',
  sidebar: 'cnpg-clusters',
  // Route "name" must be unique across Headlamp (built-in and plugins) — 'Cluster'/'cluster'
  // collides with Headlamp's own multi-cluster context route, so these are prefixed.
  name: 'CNPG Clusters',
  // Without this, this route's path can still prefix-match the (longer) detail route's path
  // below, so this list keeps rendering instead of yielding to the detail route.
  exact: true,
  component: () => <ClustersList />,
});

registerRoute({
  path: '/cnpg/clusters/:namespace/:name',
  sidebar: 'cnpg-clusters',
  name: 'CNPG Cluster',
  exact: true,
  component: () => <ClusterDetail />,
});

registerRoute({
  path: '/cnpg/databases',
  sidebar: 'cnpg-databases',
  name: 'CNPG Databases',
  exact: true,
  component: () => <DatabasesList />,
});

registerRoute({
  path: '/cnpg/databases/:namespace/:name',
  sidebar: 'cnpg-databases',
  name: 'CNPG Database',
  exact: true,
  component: () => <DatabaseDetail />,
});

registerRoute({
  path: '/cnpg/databaseroles',
  sidebar: 'cnpg-database-roles',
  name: 'CNPG Database Roles',
  exact: true,
  component: () => <DatabaseRolesList />,
});

registerRoute({
  path: '/cnpg/databaseroles/:namespace/:name',
  sidebar: 'cnpg-database-roles',
  name: 'CNPG Database Role',
  exact: true,
  component: () => <DatabaseRoleDetail />,
});

registerRoute({
  path: '/cnpg/poolers',
  sidebar: 'cnpg-poolers',
  name: 'CNPG Poolers',
  exact: true,
  component: () => <PoolersList />,
});

registerRoute({
  path: '/cnpg/poolers/:namespace/:name',
  sidebar: 'cnpg-poolers',
  name: 'CNPG Pooler',
  exact: true,
  component: () => <PoolerDetail />,
});

registerRoute({
  path: '/cnpg/objectstores',
  sidebar: 'cnpg-object-stores',
  name: 'CNPG Object Stores',
  exact: true,
  component: () => <ObjectStoresList />,
});

registerRoute({
  path: '/cnpg/objectstores/:namespace/:name',
  sidebar: 'cnpg-object-stores',
  name: 'CNPG Object Store',
  exact: true,
  component: () => <ObjectStoreDetail />,
});

registerRoute({
  path: '/cnpg/backups',
  sidebar: 'cnpg-backups',
  name: 'CNPG Backups',
  exact: true,
  component: () => <BackupsList />,
});

registerRoute({
  path: '/cnpg/backups/:namespace/:name',
  sidebar: 'cnpg-backups',
  name: 'CNPG Backup',
  exact: true,
  component: () => <BackupDetail />,
});

registerRoute({
  path: '/cnpg/scheduledbackups',
  sidebar: 'cnpg-scheduled-backups',
  name: 'CNPG Scheduled Backups',
  exact: true,
  component: () => <ScheduledBackupsList />,
});

registerRoute({
  path: '/cnpg/scheduledbackups/:namespace/:name',
  sidebar: 'cnpg-scheduled-backups',
  name: 'CNPG Scheduled Backup',
  exact: true,
  component: () => <ScheduledBackupDetail />,
});

registerRoute({
  path: '/cnpg/publications',
  sidebar: 'cnpg-publications',
  name: 'CNPG Publications',
  exact: true,
  component: () => <PublicationsList />,
});

registerRoute({
  path: '/cnpg/publications/:namespace/:name',
  sidebar: 'cnpg-publications',
  name: 'CNPG Publication',
  exact: true,
  component: () => <PublicationDetail />,
});

registerRoute({
  path: '/cnpg/subscriptions',
  sidebar: 'cnpg-subscriptions',
  name: 'CNPG Subscriptions',
  exact: true,
  component: () => <SubscriptionsList />,
});

registerRoute({
  path: '/cnpg/subscriptions/:namespace/:name',
  sidebar: 'cnpg-subscriptions',
  name: 'CNPG Subscription',
  exact: true,
  component: () => <SubscriptionDetail />,
});

registerRoute({
  path: '/cnpg/imagecatalogs',
  sidebar: 'cnpg-image-catalogs',
  name: 'CNPG Image Catalogs',
  exact: true,
  component: () => <ImageCatalogsList />,
});

registerRoute({
  path: '/cnpg/imagecatalogs/:namespace/:name',
  sidebar: 'cnpg-image-catalogs',
  name: 'CNPG Image Catalog',
  exact: true,
  component: () => <ImageCatalogDetail />,
});

registerRoute({
  path: '/cnpg/clusterimagecatalogs',
  sidebar: 'cnpg-cluster-image-catalogs',
  name: 'CNPG Cluster Image Catalogs',
  exact: true,
  component: () => <ClusterImageCatalogsList />,
});

// Cluster-scoped, so this route has no :namespace segment — same pattern as ClusterIssuer in the
// official cert-manager plugin.
registerRoute({
  path: '/cnpg/clusterimagecatalogs/:name',
  sidebar: 'cnpg-cluster-image-catalogs',
  name: 'CNPG Cluster Image Catalog',
  exact: true,
  component: () => <ClusterImageCatalogDetail />,
});

// Reached only via the "View logs" action on a pod (cluster/pooler/status pages), never directly
// from the sidebar — but `sidebar: null` (rather than pointing at an existing entry) would hide
// the *entire* sidebar while this route is active, not just skip highlighting an item, per
// Sidebar.js's `sidebar.selected.sidebar === null` check. 'cnpg-clusters' keeps the sidebar
// visible; which entry it highlights doesn't matter much since pods aren't in the sidebar anyway.
// A standalone page rather than an Activity overlay: see the comment on PodLogsPage for why the
// Activity approach broke in Headlamp 0.45.
registerRoute({
  path: '/cnpg/pods/:namespace/:name/logs',
  sidebar: 'cnpg-clusters',
  name: 'CNPG Pod Logs',
  exact: true,
  component: () => <PodLogsPage />,
});

// Same rationale as the route above (see its comment): reached only via the "Open terminal"
// action, never the sidebar, and a standalone page rather than an Activity overlay because
// Terminal's noDialog mode has the same '.xterm { height: 100vh }' assumption that broke inside
// Headlamp 0.45's Activities framework.
registerRoute({
  path: '/cnpg/pods/:namespace/:name/terminal',
  sidebar: 'cnpg-clusters',
  name: 'CNPG Pod Terminal',
  exact: true,
  component: () => <PodTerminalPage />,
});
