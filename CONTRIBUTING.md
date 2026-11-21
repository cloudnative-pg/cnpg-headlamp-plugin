# Contributing to CloudNativePG

Thank you for your interest in contributing! 💖

To ensure consistency across the project, all CloudNativePG repositories follow
a common set of guidelines regarding code of conduct, AI usage, and
contribution workflows.

Please review the [CloudNativePG Project contributing guidelines](https://github.com/cloudnative-pg/governance/blob/main/CONTRIBUTING.md)
before searching for issues, reporting bugs, or submitting a pull request.

## Development

### Requirements

**To develop this plugin:**

- [mise](https://mise.jdx.dev/) — manages the Node.js/npm versions used by this project
- A local [Headlamp](https://headlamp.dev/) installation to load the plugin into

Once packaged and distributed, the plugin only requires a [Headlamp](https://headlamp.dev/) installation to run — `mise` is a development-time dependency only.

### Installation (local Headlamp)

From the repo root:

```bash
mise exec -- npm install
mise exec -- npm start
```

`npm start` builds the plugin in watch mode; load it into your running Headlamp instance to see it, and changes will rebuild automatically as you edit.

### Live-load smoke check

A green `tsc` / `lint` / `build` doesn't prove the plugin actually loads in Headlamp — a value imported from a path that isn't externalized at runtime resolves to `undefined` and throws on load, and a wrong `sidebar:` reference on a route fails silently instead of throwing. `scripts/cdp-verify.mjs` catches both by driving a running Headlamp over the Chrome DevTools Protocol.

This requires a local clone of the [Headlamp](https://github.com/headlamp-k8s/headlamp) repo (to run Headlamp itself with the DevTools port open), in addition to this plugin's checkout. Both use `mise` and require Node 26.

```bash
# in this repo
mise exec node@26 -- npm start                      # watch build, deploys into Headlamp

# in the Headlamp checkout
mise exec node@26 -- npm run install:all           # first-time setup only
mise exec node@26 -- npm run start:with-app:debug   # backend :4466, vite :3000, Electron :9222

# back in this repo
mise exec node@26 -- node scripts/cdp-verify.mjs [cluster-name]   # default: kind-headlamp-test, or set HEADLAMP_CLUSTER
```

The script exits non-zero if this plugin fails to load or a route renders nothing.

### Regenerating screenshots

The shots in the README are automated — no manual cropping. Seed an "interesting" demo
namespace once per cluster, then capture:

```bash
# once per cluster (needs kubectl pointed at the cluster Headlamp shows)
./screenshots/seed-demo.sh --wait

# each capture run:
mise exec -- npm start                      # watch build, deploys into Headlamp

# Launch the AppImage with the CDP endpoint enabled (just opening the DevTools
# *window* (F12) is NOT enough — the script needs the HTTP endpoint):
./Headlamp-*.AppImage --remote-debugging-port=9222
# Verify with: curl -s http://localhost:9222/json | head -c 200

mise exec -- npm run screenshots             # writes img/*.png (1440x900 @2x)
# single shot while iterating:
# mise exec -- node scripts/cdp-screenshots.mjs my-cluster --only=cluster-detail
```

Notes: the script reuses the `cdp-verify.mjs` CDP setup (no new dependencies) and
prefers the demo objects (`cnpg-demo/demo-pg`, `cnpg-demo/demo-db`) so shots are
stable; without them it falls back to the first row in each list.

### Generating PostgreSQL log traffic

The cluster **Logs** tab is only interesting when Postgres has something to say. `scripts/generate-pg-logs.sh` creates a declarative `Database` (default `<cluster>-logdemo`) in a CNPG cluster and runs scenarios that produce each log category: connections and failed logins, slow statements and temp-file spills, constraint violations, application errors (permission denied, timeouts, syntax errors), lock waits and a deadlock, WAL/checkpoints, autovacuum, standby reconnects and config reloads.

```bash
scripts/generate-pg-logs.sh                                  # current kubectl context, default/demo1
scripts/generate-pg-logs.sh --context kind-demo -n default -c demo1 -r 6 -i 30   # 6 rounds, 30s apart
scripts/generate-pg-logs.sh run locks errors                 # only some stages
scripts/generate-pg-logs.sh --help                           # all options and stages
scripts/generate-pg-logs.sh teardown                         # remove everything it created
```

Besides the database and a `logdemo_readonly` role, it patches three logging parameters into the Cluster's `spec.postgresql.parameters` (`log_connections`, `log_disconnections`, `log_autovacuum_min_duration`), because Postgres can't set them per database; `teardown` removes them again. The remaining settings (slow-statement threshold, lock-wait and temp-file logging, DDL logging) are applied with `ALTER DATABASE` on the demo database only. Only run it against a cluster you're happy to add demo data to.
