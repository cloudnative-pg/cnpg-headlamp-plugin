#!/usr/bin/env node
/**
 * Captures the README screenshots (`img/*.png`) from a running Headlamp over CDP.
 *
 * Same setup as scripts/cdp-verify.mjs — no dependencies, node's built-in
 * WebSocket + fetch only. The demo data comes from screenshots/cnpg-demo.yaml
 * (see screenshots/seed-demo.sh); any cluster works, but shots are only
 * "interesting" once that demo namespace exists and the instances are Running.
 *
 * Usage:
 *   1. npm start                                   # watch build, deploys into Headlamp
 *   2. Headlamp running with DevTools open:
 *        Electron: npm run start:with-app:debug   # :9222 (in the Headlamp checkout)
 *        --or-- plain Chrome/Chromium headless against the frontend:
 *        google-chrome --headless=new --no-sandbox \
 *          --user-agent="Mozilla/5.0 Electron/32.0.0 Chrome Safari" \
 *          --remote-debugging-port=9222 http://localhost:3000
 *      (the UA spoof sidesteps Headlamp's single-cluster Home redirect that would
 *      otherwise stomp hash navigations — same trick as the CI smoke test.)
 *   3. ./screenshots/seed-demo.sh --wait          # once per cluster
 *   4. node scripts/cdp-screenshots.mjs [headlamp-cluster-name] [--out=img] [--only=a,b,c]
 *
 * The cluster name defaults to HEADLAMP_CLUSTER, else whatever cluster the open
 * page is already on, else the first `#/c/<name>/` link found in the DOM.
 *
 * Viewport is fixed (1440x900 @2x) so re-runs produce same-size shots regardless
 * of the laptop driving them. Captures are full-page (captureBeyondViewport).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const CDP_HTTP = process.env.CDP_URL || 'http://localhost:9222';
const VIEWPORT_W = parseInt(process.env.SCREENSHOTS_WIDTH || '1440', 10);
const VIEWPORT_H = parseInt(process.env.SCREENSHOTS_HEIGHT || '900', 10);
const SCALE = parseFloat(process.env.SCREENSHOTS_SCALE || '2');

const args = process.argv.slice(2);
const flag = name => {
  const hit = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
if (flag('help') || args.includes('-h')) {
  console.log(`Usage: node scripts/cdp-screenshots.mjs [cluster-name] [--out=img] [--only=a,b,c]

Shots: operator-status, cluster-list, cluster-detail, live-metrics, cluster-form,
       scheduled-backup-list, database-detail
Env: CDP_URL, HEADLAMP_CLUSTER, SCREENSHOTS_WIDTH/HEIGHT/SCALE, OUT_DIR`);
  process.exit(0);
}
const OUT_DIR = flag('out') === true ? 'img' : flag('out') || process.env.OUT_DIR || 'img';
const ONLY = (flag('only') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
let clusterArg = args.find(a => !a.startsWith('--')) || process.env.HEADLAMP_CLUSTER || '';

const targets = await (await fetch(`${CDP_HTTP}/json`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) {
  console.error(`No page target on ${CDP_HTTP} — is Headlamp running with --remote-debugging-port?`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate threw');
  }
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Same poll-until-truthy helper as cdp-verify.mjs: Headlamp's sidebar/route settling is
// Redux-driven and load-dependent, so a fixed sleep races on slower machines.
const waitFor = async (conditionExpr, { timeoutMs = 15000, intervalMs = 300 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(conditionExpr)) return true;
    await sleep(intervalMs);
  }
  return false;
};

await new Promise(r => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.enable');
// Fixed viewport => deterministic shot dimensions regardless of the driving laptop.
await send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT_W,
  height: VIEWPORT_H,
  deviceScaleFactor: SCALE,
  mobile: false,
});

const HEADING_SELECTOR = 'h1, h2, [class*="SectionHeader"]';
const currentHeading = () =>
  evaluate(`(() => {
    const h = document.querySelector('${HEADING_SELECTOR}');
    return h ? h.textContent.trim() : null;
  })()`);

// Same settle logic as cdp-verify.mjs: wait for the heading to *change* (hashchange fires
// async, so "a heading exists" can pass against stale content) and the spinner to clear.
const navigateAndSettle = async hash => {
  const before = await currentHeading();
  await evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
  await waitFor(
    `(() => {
      const h = document.querySelector('${HEADING_SELECTOR}');
      const text = h ? h.textContent.trim() : null;
      const noSpinner = !document.querySelector('[role="progressbar"]');
      return text !== ${JSON.stringify(before)} && noSpinner;
    })()`,
    { timeoutMs: 15000 }
  );
  // One extra beat for MUI Collapse/table virtualization to finish painting.
  await sleep(800);
};

const capture = async file => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(data, 'base64'));
  console.log(`  wrote ${file}`);
};

// First `#/c/<cluster>/…` link in the DOM — lets `npm run screenshots` work with no args.
const discoverCluster = () =>
  evaluate(`(() => {
    const m = (window.location.hash || '').match(/^#\\/c\\/([^/]+)/);
    if (m) return m[1];
    const a = Array.from(document.querySelectorAll('a[href]'))
      .map(x => x.getAttribute('href') || '').find(h => h.includes('#/c/'));
    const m2 = a && a.match(/#\\/c\\/([^/]+)/);
    return m2 ? m2[1] : null;
  })()`);

const CLUSTER = clusterArg || (await discoverCluster()) || 'kind-headlamp-test';
console.log(`Cluster: ${CLUSTER}  (${VIEWPORT_W}x${VIEWPORT_H} @${SCALE}x -> ${OUT_DIR}/)`);
// Land in cluster context first: Headlamp only renders this plugin's routes/sidebar there.
await navigateAndSettle(`#/c/${CLUSTER}/cnpg/status`);

// Detail links: prefer the demo objects (stable names for stable shots), else first row link.
// Navigates to the list first — discovery reads the current DOM, so it must run there.
const detailHrefFromList = async (listPath, preferred, regexSrc) => {
  await navigateAndSettle(`#${listPath}`);
  return evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href') || '');
    const pref = links.find(h => h.includes(${JSON.stringify(preferred)}));
    if (pref) return pref;
    const re = new RegExp(${JSON.stringify(regexSrc)});
    return links.find(h => re.test(h)) || null;
  })()`);
};

const shots = [
  {
    name: 'operator-status',
    run: async () => {
      await navigateAndSettle(`#/c/${CLUSTER}/cnpg/status`);
      await capture(`${OUT_DIR}/operator-status.png`);
    },
  },
  {
    name: 'cluster-list',
    run: async () => {
      await navigateAndSettle(`#/c/${CLUSTER}/cnpg/clusters`);
      await capture(`${OUT_DIR}/cluster-list.png`);
    },
  },
  {
    name: 'cluster-detail',
    run: async () => {
      const href = await detailHrefFromList(
        `/c/${CLUSTER}/cnpg/clusters`,
        '/cnpg/clusters/cnpg-demo/demo-pg',
        '/cnpg/clusters/[^/]+/[^/]+$'
      );
      if (!href) throw new Error('no Cluster found — apply screenshots/cnpg-demo.yaml first?');
      await navigateAndSettle(href.startsWith('#') ? href : `#${href}`);
      await capture(`${OUT_DIR}/cluster-detail.png`);
    },
  },
  {
    name: 'live-metrics',
    run: async () => {
      const href = await detailHrefFromList(
        `/c/${CLUSTER}/cnpg/clusters`,
        '/cnpg/clusters/cnpg-demo/demo-pg',
        '/cnpg/clusters/[^/]+/[^/]+$'
      );
      if (!href) throw new Error('no Cluster found — apply screenshots/cnpg-demo.yaml first?');
      await navigateAndSettle(href.startsWith('#') ? href : `#${href}`);
      // Metrics are scraped live from each instance's :9187 exporter — wait for the section
      // to mount, then give the scrape an extra beat before capturing.
      const ready = await waitFor(
        `document.body.textContent.includes('Live Metrics')`,
        { timeoutMs: 15000 }
      );
      if (!ready) console.warn('  warning: Live Metrics section not found — capturing anyway');
      await evaluate(`(() => {
        const els = Array.from(document.querySelectorAll('*')).filter(e =>
          e.children.length === 0 && (e.textContent || '').trim() === 'Live Metrics');
        (els[0] || document.body).scrollIntoView({ block: 'start' });
      })()`);
      await sleep(4000);
      await capture(`${OUT_DIR}/live-metrics.png`);
    },
  },
  {
    name: 'cluster-form',
    run: async () => {
      await navigateAndSettle(`#/c/${CLUSTER}/cnpg/clusters`);
      // The create form is an Activity overlay, not a route — open it like a user would.
      await evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('button'))
          .find(x => (x.textContent || '').includes('Create / Restore Cluster'));
        if (!b) throw new Error('create button not found');
        b.click();
      })()`);
      const ready = await waitFor(
        `document.body.textContent.includes('Create / Restore Cluster') && document.body.textContent.includes('YAML')`,
        { timeoutMs: 10000 }
      );
      if (!ready) throw new Error('create form overlay did not open');
      await sleep(800);
      await capture(`${OUT_DIR}/cluster-form.png`);
      // Dismiss the overlay so later shots start clean.
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
      await sleep(500);
    },
  },
  {
    name: 'scheduled-backup-list',
    run: async () => {
      await navigateAndSettle(`#/c/${CLUSTER}/cnpg/scheduledbackups`);
      await capture(`${OUT_DIR}/scheduled-backup-list.png`);
    },
  },
  {
    name: 'database-detail',
    run: async () => {
      const href = await detailHrefFromList(
        `/c/${CLUSTER}/cnpg/databases`,
        '/cnpg/databases/cnpg-demo/demo-db',
        '/cnpg/databases/[^/]+/[^/]+$'
      );
      if (!href) {
        console.warn('  warning: no Database found — capturing the list instead');
        await navigateAndSettle(`#/c/${CLUSTER}/cnpg/databases`);
      } else {
        await navigateAndSettle(href.startsWith('#') ? href : `#${href}`);
      }
      await capture(`${OUT_DIR}/database-detail.png`);
    },
  },
];

const selected = ONLY.length ? shots.filter(s => ONLY.includes(s.name)) : shots;
if (!selected.length) {
  console.error(`No matching shots for --only=${ONLY.join(',')}`);
  process.exit(1);
}
for (const shot of selected) {
  console.log(`-- ${shot.name}`);
  await shot.run();
}

ws.close();
console.log(`\nOK: ${selected.length} screenshot(s) in ${OUT_DIR}/`);
