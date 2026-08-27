[![CloudNativePG](./logo/cloudnativepg.png)](https://cloudnative-pg.io/)

# CNPG Headlamp Plugin

A [Headlamp](https://headlamp.dev/) plugin for managing and visualizing [CloudNativePG](https://cloudnative-pg.io/) (CNPG) resources — Clusters, Poolers, Backups, Scheduled Backups, and Database objects — directly from the Headlamp UI.

## Features

#### Clusters

List and detail views, plus a guided creation form.

- Traffic-light health indicator (phase, WAL archiving, last backup)
- Instance roles and synchronous replication warnings
- Per-instance Postgres logs (filterable, color-coded, live-following)
- A `psql` terminal against the primary or any replica
- A manual **switchover** action to promote a chosen replica to primary
- Leader-election **lease** details (holder, acquire/renew time, duration, transitions) alongside the cluster's main info
- Creation form (with live YAML preview) covering instances/HA, storage and tablespaces, backup configuration, volume snapshots, and bootstrap — including bootstrapping a new cluster from an existing backup

#### Poolers (PgBouncer)

List/detail views and a guided creation form.

#### Backups

On-demand backups with status tracking, created against the Barman Cloud plugin or via volume snapshots (not the deprecated in-tree `barmanObjectStore`).

#### Scheduled Backups

- Graphical cron editor (Daily/Weekly/Monthly, plus a raw-text advanced mode) with a humanized schedule description
- A "trigger now" action

#### Object Stores

Manage the `ObjectStore` CRs backing the Barman Cloud plugin, with a "referring clusters" section showing which clusters use each store for backup and/or recovery.

#### Database objects

List/detail/create views for `Database`, `DatabaseRole`, `Publication`, and `Subscription`, each showing reconciliation status.

#### Image Catalogs / Cluster Image Catalogs

List and detail views for managing available Postgres operand images.

#### Operator status page

- Installed CNPG CRDs and operator pod health
- Detected CNPG-i plugins (e.g. Barman Cloud), with quick access to their logs

## Requirements

**To develop this plugin:**

- [mise](https://mise.jdx.dev/) — manages the Node.js/npm versions used by this project
- A local [Headlamp](https://headlamp.dev/) installation to load the plugin into

Once packaged and distributed, the plugin only requires a [Headlamp](https://headlamp.dev/) installation to run — `mise` is a development-time dependency only.

## Installation (local Headlamp)

From the repo root:

```bash
mise exec -- npm install
mise exec -- npm start
```

`npm start` builds the plugin in watch mode; load it into your running Headlamp instance to see it, and changes will rebuild automatically as you edit.

## Live-load smoke check

A green `tsc` / `lint` / `build` doesn't prove the plugin actually loads in Headlamp — a value imported from a path that isn't externalized at runtime resolves to `undefined` and throws on load, and a wrong `sidebar:` reference on a route fails silently instead of throwing. `scripts/cdp-verify.mjs` catches both by driving a running Headlamp over the Chrome DevTools Protocol.

This requires a local clone of the [Headlamp](https://github.com/headlamp-k8s/headlamp) repo (to run Headlamp itself with the DevTools port open), in addition to this plugin's checkout. Both use `mise` and require Node 22.

```bash
# in this repo
mise exec node@22 -- npm start                      # watch build, deploys into Headlamp

# in the Headlamp checkout
mise exec node@22 -- npm run install:all           # first-time setup only
mise exec node@22 -- npm run start:with-app:debug   # backend :4466, vite :3000, Electron :9222

# back in this repo
mise exec node@22 -- node scripts/cdp-verify.mjs [cluster-name]   # default: kind-headlamp-test, or set HEADLAMP_CLUSTER
```

The script exits non-zero if this plugin fails to load or a route renders nothing.

## Screenshots

<table>
  <tr>
    <td><img src="img/operator-status.png" alt="Operator status page" width="400"></td>
    <td><img src="img/cluster-list.png" alt="Cluster list" width="400"></td>
  </tr>
  <tr>
    <td><img src="img/cluster-detail.png" alt="Cluster detail" width="400"></td>
    <td><img src="img/cluster-form.png" alt="Cluster creation form" width="400"></td>
  </tr>
  <tr>
    <td><img src="img/scheduled-backup-list.png" alt="Scheduled backups list" width="400"></td>
    <td><img src="img/database-detail.png" alt="Database detail" width="400"></td>
  </tr>
</table>

## License

Licensed under the [Apache License 2.0](LICENSE).
