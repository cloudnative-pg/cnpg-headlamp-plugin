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

This requires a local clone of the [Headlamp](https://github.com/headlamp-k8s/headlamp) repo (to run Headlamp itself with the DevTools port open), in addition to this plugin's checkout. Both use `mise` and require Node 24.

```bash
# in this repo
mise exec node@24 -- npm start                      # watch build, deploys into Headlamp

# in the Headlamp checkout
mise exec node@24 -- npm run install:all           # first-time setup only
mise exec node@24 -- npm run start:with-app:debug   # backend :4466, vite :3000, Electron :9222

# back in this repo
mise exec node@24 -- node scripts/cdp-verify.mjs [cluster-name]   # default: kind-headlamp-test, or set HEADLAMP_CLUSTER
```

The script exits non-zero if this plugin fails to load or a route renders nothing.

### Regenerating screenshots

The shots in the README are automated — no manual cropping. Seed an "interesting" demo
namespace once per cluster, then capture:

```bash
# once per cluster (needs kubectl pointed at the cluster Headlamp shows)
./screenshots/seed-demo.sh --wait

# wait until the demo instances are Running for live-metrics.png:
# kubectl wait --for=condition=Ready pod -l cnpg.io/cluster=demo-pg -n cnpg-demo --timeout=600s

# each capture run:
mise exec -- npm start                      # watch build, deploys into Headlamp

# Launch the AppImage with the CDP endpoint enabled (just opening the DevTools
# *window* (F12) is NOT enough — the script needs the HTTP endpoint):
./Headlamp-*.AppImage --remote-debugging-port=9222
# Verify with: curl -s http://localhost:9222/json | head -c 200

mise exec -- npm run screenshots             # writes img/*.png (1440x900 @2x)
# single shot while iterating:
# mise exec -- node scripts/cdp-screenshots.mjs my-cluster --only=cluster-detail,live-metrics
```

Notes: the script reuses the `cdp-verify.mjs` CDP setup (no new dependencies) and
prefers the demo objects (`cnpg-demo/demo-pg`, `cnpg-demo/demo-db`) so shots are
stable; without them it falls back to the first row in each list. `live-metrics`
is scraped live from the instances' `:9187` exporter, so it needs Running pods
and varies run to run — re-shoot just that one with `--only=live-metrics`.
