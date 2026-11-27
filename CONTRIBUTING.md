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

The README screenshots (`img/*.png`) are taken by a script that connects to a running Headlamp Desktop and captures each page (1440x900, light theme; the Logs shot is taller). The data comes from a demo cluster that `screenshots/demo.sh` sets up. The steps below do everything on a throwaway kind cluster.

You need Docker, [kind](https://kind.sigs.k8s.io/), `kubectl`, [Helm](https://helm.sh/), `mise` (Node 26) and Headlamp Desktop. It takes about 15 minutes, mostly waiting for the cluster.

This uses your default kubeconfig: `kind create cluster` adds the context `kind-cnpg-screenshots` and makes it the current one. At the end, switch back with `kubectl config use-context <your previous context>`.

```bash
# 1. The kind cluster, the snapshot CRDs (the demo's scheduled backup needs them) and the operator
kind create cluster --name cnpg-screenshots
SNAP=https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/v8.2.0/client/config/crd
for f in volumesnapshotclasses volumesnapshotcontents volumesnapshots; do
  kubectl apply --server-side -f "$SNAP/snapshot.storage.k8s.io_$f.yaml"
done
kubectl apply --server-side -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.30/releases/cnpg-1.30.2.yaml
kubectl rollout status deployment -n cnpg-system cnpg-controller-manager

# 2. The plugins shown on the operator status page: Barman Cloud and Klio (both need cert-manager)
kubectl apply --server-side -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.3/cert-manager.yaml
for d in cert-manager cert-manager-cainjector cert-manager-webhook; do
  kubectl -n cert-manager rollout status deployment/$d
done
kubectl apply -f https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.16.0/manifest.yaml
helm install klio-operator oci://ghcr.io/cloudnative-pg/klio-operator-chart \
  --version 0.0.21 --namespace cnpg-system --set prometheus.enable=false
kubectl -n cnpg-system rollout status deployment/barman-cloud
kubectl -n cnpg-system rollout status deployment/klio-operator-controller-manager

# 3. The demo cluster, with some log activity for the Logs tab
./screenshots/demo.sh create
```

Then, in a second terminal (it keeps running):

```bash
# 4. Build the plugin and load it into Headlamp (watch mode)
mise exec -- npm start
```

And in a third one, start Headlamp Desktop with its DevTools port open. Quit it completely first (on macOS, closing the window does not quit it, use Cmd+Q), otherwise the flag is ignored. Opening the DevTools window (F12) is not enough, the script needs the port.

**Step 5.** On macOS:

```bash
open -a Headlamp --args --remote-debugging-port=9222
```

On Linux (AppImage):

```bash
./Headlamp-*.AppImage --remote-debugging-port=9222
```

Then check that it answers:

```bash
curl -s http://localhost:9222/json | head -c 200
```

Back in the first terminal:

```bash
# 6. Take the screenshots; the argument is the cluster name in Headlamp
mise exec -- npm run screenshots -- kind-cnpg-screenshots     # writes img/*.png
# a single shot while iterating:
# mise exec -- node scripts/cdp-screenshots.mjs kind-cnpg-screenshots --only=cluster-logs

# 7. Check img/*.png, then clean up: stop npm start (Ctrl-C), quit Headlamp, and
kind delete cluster --name cnpg-screenshots                   # removes the cluster and its context
kubectl config use-context <your previous context>
# (to keep the cluster and only remove the demo: screenshots/demo.sh teardown)
```

Notes:

- The script uses the demo's objects (`cnpg-demo/demo-pg-ha`, `cnpg-demo/demo-db`) when they exist, and otherwise the first item in each list.
- The shots are light. Headlamp's own theme setting wins over your OS, so if it is set to Dark the script stops and asks you to change it (Settings > General > Theme: Light or Use system). `SCREENSHOTS_THEME=dark` takes dark shots instead. Other settings: `CDP_URL`, `HEADLAMP_CLUSTER`, `SCREENSHOTS_WIDTH`, `SCREENSHOTS_HEIGHT`, `SCREENSHOTS_SCALE`, `OUT_DIR`.
- The Logs shot covers everything the cluster has logged so far, so take it soon after `demo.sh create`, while the log is short. On an older demo, run `screenshots/demo.sh teardown` and then `create` again first.
- Headlamp lists every cluster in your kubeconfig. The script only visits the cluster you name.

### The demo environment

`screenshots/demo.sh` sets up the demo behind the screenshots, adds log activity to it, and removes it:

```bash
screenshots/demo.sh create                       # namespace cnpg-demo: Cluster demo-pg-ha (3 instances), Pooler, Database, ScheduledBackup
screenshots/demo.sh --context kind-demo create   # same, in another kubectl context
screenshots/demo.sh --storage-class NAME create  # instead of the default storage class
screenshots/demo.sh traffic -r 6 -i 30           # more log activity: 6 rounds, 30 seconds apart
screenshots/demo.sh traffic locks errors         # only some stages
screenshots/demo.sh teardown                     # delete the demo
screenshots/demo.sh --help                       # all options and stages
```

`create` applies [`screenshots/cnpg-demo.yaml`](screenshots/cnpg-demo.yaml), waits until the cluster is healthy and adds sample data to `demo-db`. (Without the VolumeSnapshot CRD, as on a plain kind cluster, the operator rejects the demo's scheduled backup, so `create` leaves it out and the scheduled-backup screenshot is empty.) Then it runs one round of log activity so the cluster's **Logs** tab has content: logins and failed logins, slow queries, constraint errors, application errors (permission denied, timeouts, syntax errors), lock waits and a deadlock, WAL and checkpoints, autovacuum, replica reconnects and config reloads. Use `-r 0` to skip it.

`create` never reuses a demo: if the `cnpg-demo` namespace already exists, it stops. Run `teardown` first, or `traffic` to add more log activity to the existing demo. `teardown` only deletes a namespace that `create` labeled. `create` makes a whole cluster, so check the context it prints first.
