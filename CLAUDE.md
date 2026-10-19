# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This is a freshly scaffolded [Headlamp](https://headlamp.dev/) plugin (via `@kinvolk/headlamp-plugin create`), intended to become a plugin for managing/visualizing [CloudNativePG](https://cloudnative-pg.io/) (CNPG) resources inside Headlamp. `src/index.tsx` currently only contains the generator's placeholder `registerAppBarAction` call — no CNPG-specific functionality has been built yet.

## Commands

Run all commands from the repo root (there is no monorepo/workspace nesting).

Node/npm are managed via `mise` — they aren't on `PATH` by default, so use `mise exec -- <cmd>` (or a shell with mise activated) rather than bare `node`/`npm`/`npx`.

- `npm start` — start the dev build in watch mode (load the built plugin into a running Headlamp instance to see changes)
- `npm run build` — production build
- `npm run tsc` — TypeScript type checking (no separate `tsconfig` targets; single `tsconfig.json` extends the shared Headlamp plugin config)
- `npm run lint` / `npm run lint-fix` — ESLint (config: `@headlamp-k8s` + `prettier` + `jsx-a11y/recommended`, defined inline in `package.json`)
- `npm run format` — Prettier (config: `@headlamp-k8s/eslint-config/prettier-config`)
- `npm test` — run tests with vitest (no test files exist yet; add `*.test.tsx`/`*.test.ts` next to source)
- `npm run storybook` / `npm run storybook-build` — Storybook for isolated component development
- `npm run i18n [locale]` — extract/add translation strings (e.g. `npm run i18n es`); translations live in `locales/<locale>/translation.json`
- `npm run package` — produce a distributable tarball of the plugin

There is no single-test-file runner script exposed; use vitest's own filtering (e.g. `npx headlamp-plugin test <pattern>` or vitest CLI flags) once test files exist.

## Architecture

Headlamp plugins are React/TypeScript modules that register into a running Headlamp app via imperative `register*` calls from `@kinvolk/headlamp-plugin/lib`, evaluated once at plugin load time (see `src/index.tsx`). There is no framework-managed routing/entry lifecycle beyond this — everything the plugin does (sidebar entries, app bar actions, custom resource tables, detail-view customizations, map/graph visualizations, charts) is registered explicitly, typically as top-level calls or components passed into those registration functions.

Key registration entry points (all imported from `@kinvolk/headlamp-plugin/lib`):
- `registerAppBarAction` — add UI to the top app bar
- `registerSidebarEntry` / `registerSidebarEntryFilter` — customize navigation
- Resource/detail-view and custom table registration — used to surface CNPG custom resources (Clusters, Backups, Poolers, etc.) once CNPG CRD types are modeled
- Map/graph edge helpers (e.g. `makeKubeToKubeEdge`) — for visualizing relationships between CNPG resources

Since this plugin will target CloudNativePG CRDs, the `official-plugins/cert-manager`, `official-plugins/flux`, and `official-plugins/keda` examples under `node_modules/@kinvolk/headlamp-plugin/official-plugins/` are the most relevant references for the CRD-integration pattern this plugin will need (defining a resource class, listing/detail views, and optionally a map view). See `AGENTS.md` in this repo for a fuller index of example and official plugins bundled in `node_modules`, organized by topic (CRDs, map views, charts/metrics, i18n).

`i18n` uses the `useTranslation()` hook from `@kinvolk/headlamp-plugin/i18n`, not `react-i18next` directly.

### Backups: target the Barman Cloud plugin, not in-tree barman-cloud

CNPG is deprecating its in-tree `barmanObjectStore` integration in favor of the Barman Cloud **plugin** (CNPG plugin interface + `ObjectStore` CR). Any backup/recovery work in this plugin (listing, creating, scheduling, or recovering from backups) should target that plugin-based integration, not the legacy in-tree `spec.backup.barmanObjectStore` / `bootstrap.recovery.backup.barmanObjectStore` fields.

### Actions that modify cluster resources must be disabled for read-only users

Any new UI action that mutates a resource (create, edit, delete, or a bespoke action like switchover) must check RBAC and disable itself — not just hide itself — when the user lacks the required verb, matching the existing pattern (e.g. `src/components/clusters/switchover.tsx`, `src/components/common/AuthDisabledButton.tsx`): wrap the action in `AuthVisible` (from `@kinvolk/headlamp-plugin/lib/CommonComponents`) with the relevant `authVerb`/`subresource`, use its `onAuthResult` callback to track an `allowed` boolean (defaulting to `true` until the check resolves, so the button fails open as a UX nicety — the API call itself is still enforced server-side by RBAC), and render the action `disabled` with an explanatory `Tooltip` when denied. Prefer wrapping with `AuthDisabledButton` for plain MUI buttons; for components that don't accept a bare `disabled` prop (e.g. `ActionButton`, which only takes `iconButtonProps.disabled`), wire the same `AuthVisible`/`allowed`/`Tooltip` pattern in directly as `switchover.tsx` does.

### Update README.md when adding a user-facing feature

When a change adds a significant feature for users (a new resource view, a new action, a new form/workflow), add or update a bullet in the README.md `## Features` section describing it. The README is the plugin's user-facing feature list, not just a dev setup doc, and it drifts out of date if this isn't done alongside the code change.

## SDK gotchas learned the hard way

These cost real debugging time — check here before re-deriving them:

- **`registerRoute` names must be globally unique**, including against Headlamp's own built-ins. Naming a route after the resource's bare `kind` (e.g. `'Cluster'`) can silently collide with a reserved core route (Headlamp's own multi-cluster context route, in that case) and break URL generation elsewhere in the app. This plugin prefixes route names (`CnpgClusterDetail`, `CnpgPoolerDetail`, ...) to avoid it.
- **Always set `exact: true` on `registerRoute`.** Without it, a shorter route's path (e.g. the list `/cnpg/poolers`) can prefix-match a longer one (`/cnpg/poolers/:namespace/:name`) and keep rendering instead of yielding — the URL changes correctly but the wrong component stays on screen.
- **`KubeObject.detailsRoute` should return a route *name*, but returning the raw path instead is a deliberate, working exception here.** The default (`static get detailsRoute() { return this.kind; }`) treats `detailsRoute` as a route name passed to `createRouteURL`. Overriding it with our own route name was observed to produce an empty link (breaking navigation) in this environment; returning the raw path string instead works via `createRouteURL`'s path-based fallback, at the cost of a harmless `[Deprecation] found by path instead of name` console warning. This matches what the official `cert-manager` plugin does — not a shortcut we invented.
- **`<ResourceLink resource={x} />` does *not* use `x.getDetailsLink()` / `x.detailsRoute`.** It defaults its route lookup to `resource.kind` (e.g. `'Pooler'`), a completely separate code path from `<Link kubeObject={x} />` (which does respect `detailsRoute`, and is what `ResourceListView`'s built-in "name" column and `getDetailsLink()` use). Since our custom classes' route names differ from their bare `kind` (previous bullet), `ResourceLink` for them needs an explicit `routeName` prop (e.g. `<ResourceLink resource={pooler} routeName="CnpgPoolerDetail" />`) or it silently produces a dead link. Core Headlamp resource types (Pod, PersistentVolumeClaim, ...) don't need this since their routes *are* registered under their bare kind name.
- **Deep `@kinvolk/headlamp-plugin/lib/...` import paths can resolve to `undefined` at runtime even when `tsc` is happy**, because Vite's external-module mapping (in the SDK's build config, not something this repo controls) guesses the runtime global from the import path, and that guess doesn't always match reality — see the `git log` around `src/resources/cluster.ts` for a case where `.../lib/k8s/KubeObject` crashed the whole plugin at load (nothing rendered, no per-component error) while `.../lib/k8s/cluster` (same `KubeObject` export, different path) worked. When something built-in isn't re-exported from the bare `@kinvolk/headlamp-plugin/lib` package, prefer copying the exact import path an official plugin under `node_modules/@kinvolk/headlamp-plugin/official-plugins/` already uses over guessing a new one — and if it silently no-ops instead of throwing, suspect the module resolved to `undefined`.
- **Never build a `history.push()` target as a raw literal path string (e.g. `` `/cnpg/backups?cluster=${name}` ``).** Registered routes default to `useClusterURL: true`, which means Headlamp mounts them at `/c/<cluster-context>/cnpg/backups`, not `/cnpg/backups` — `registerSidebarEntry`/`<Link>` go through `createRouteURL`, which adds that prefix automatically, but a hand-built literal string doesn't, and silently 404s. Build the base path with `Router.createRouteURL('<RouteName>')` (from `@kinvolk/headlamp-plugin/lib`) and append any query string to that instead, e.g. `` `${createRouteURL('CnpgBackups')}?cluster=${name}` ``. This bit all four of the Cluster-detail-page "View X" buttons at once before being caught.

## Commit message style

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope]: <description>`, e.g. `feat(clusters): add switchover action` or `fix: pin smoke-test's headlamp checkout to v0.45.0`. This is required, not just style — `release-please` (see `release-please-config.json`) parses commit types to decide version bumps and generate `CHANGELOG.md`, so a miscategorized type has a real effect on the next release.

- Common types: `feat` (new user-facing functionality — triggers a minor bump), `fix` (bug fix — triggers a patch bump), `chore`, `docs`, `refactor`, `test`, `ci`, `build`. A breaking change adds `!` after the type/scope (e.g. `feat!:`) or a `BREAKING CHANGE:` footer — triggers a major bump (or a minor bump pre-1.0, per `bump-minor-pre-major` in the config).
- Scope (optional) is a short noun for the affected area, e.g. `(clusters)`, `(backups)`, `(ci)`.
- Description is imperative mood, lowercase, no trailing period.
- Body (optional, blank line after the subject) explains *why*, not a restatement of the diff.
- Trailers in this repo are `Assisted-by: Claude` followed by `Signed-off-by: <name> <email>` (added by `git commit -s`) — not the `Co-Authored-By:` trailer some tooling defaults to.
- Match the existing `git log` for tone within this convention.

## Notes

- `AGENTS.md` in the repo root was generated by the scaffolding tool and contains a curated map of example/official plugins under `node_modules/@kinvolk/headlamp-plugin/`; consult it before implementing a new pattern (CRD tables, detail views, maps, charts) to find the closest existing example rather than starting from scratch.
- `package.json` still has placeholder `name`/`description` metadata (`"Your Headlamp plugin"`) — update it once the plugin's actual scope is defined.
