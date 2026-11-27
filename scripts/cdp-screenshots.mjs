#!/usr/bin/env node
/**
 * Captures the README screenshots (`img/*.png`) from a running Headlamp over CDP.
 *
 * Same setup as scripts/cdp-verify.mjs — no dependencies, node's built-in
 * WebSocket + fetch only. The demo data comes from screenshots/cnpg-demo.yaml
 * (created by screenshots/demo.sh); any cluster works, but shots are only
 * "interesting" once that demo namespace exists and the instances are Running.
 *
 * Usage:
 *   1. npm start                                   # watch build, deploys into Headlamp
 *   2. Headlamp running with DevTools open:
 *        Electron: npm run start:with-app:debug   # :9222 (in the Headlamp checkout)
 *        --or-- plain Chrome/Chromium headless against the frontend:
 *        google-chrome --headless=new --no-sandbox \
 *          --remote-debugging-port=9222 http://localhost:3000
 *      (Do NOT spoof an Electron UA on Headlamp 0.46+: it flips getAppUrl()
 *      to same-origin and trips the Plugin Development Mode gate, so dev-dir
 *      plugins silently stop loading. Plain Chrome fetches plugins directly
 *      from the backend :4466 instead.)
 *   3. ./screenshots/demo.sh create               # once per cluster
 *   4. node scripts/cdp-screenshots.mjs [headlamp-cluster-name] [--out=img] [--only=a,b,c]
 *
 * The cluster name defaults to HEADLAMP_CLUSTER, else whatever cluster the open
 * page is already on, else the first `#/c/<name>/` link found in the DOM.
 *
 * The viewport (1440x900 @2x) and the color scheme (light) are fixed, so every run
 * gives the same shots. Captures are full-page (captureBeyondViewport).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const CDP_HTTP = process.env.CDP_URL || 'http://localhost:9222';
const VIEWPORT_W = parseInt(process.env.SCREENSHOTS_WIDTH || '1440', 10);
const VIEWPORT_H = parseInt(process.env.SCREENSHOTS_HEIGHT || '900', 10);
const SCALE = parseFloat(process.env.SCREENSHOTS_SCALE || '2');
const THEME = process.env.SCREENSHOTS_THEME || 'light';

const args = process.argv.slice(2);
const flag = name => {
  const hit = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
if (flag('help') || args.includes('-h')) {
  console.log(`Usage: node scripts/cdp-screenshots.mjs [cluster-name] [--out=img] [--only=a,b,c]

Shots: operator-status, cluster-list, cluster-detail, cluster-logs, cluster-map, cluster-form,
       scheduled-backup-list, database-detail
Env: CDP_URL, HEADLAMP_CLUSTER, SCREENSHOTS_WIDTH/HEIGHT/SCALE, SCREENSHOTS_THEME (light|dark, default light), OUT_DIR`);
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
let viewportHeight = VIEWPORT_H;
const setViewport = async height => {
  viewportHeight = height;
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT_W,
    height,
    deviceScaleFactor: SCALE,
    mobile: false,
  });
};
await setViewport(VIEWPORT_H);
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: THEME }],
});

const HEADING_SELECTOR = 'h1, h2, [class*="SectionHeader"]';
const currentHeading = () =>
  evaluate(`(() => {
    const h = document.querySelector('${HEADING_SELECTOR}');
    return h ? h.textContent.trim() : null;
  })()`);

// Headlamp ≤0.45 (and 0.46 under Electron) routes through a HashRouter, where assigning
// window.location.hash navigates. Headlamp 0.46+ outside Electron renders a BrowserRouter,
// which ignores hash changes — there navigation must go through real link clicks, falling
// back to a full page load for link-less routes (e.g. the /clusters/new create form, which
// has no sidebar entry to click).
const routerKind = await evaluate(`(() => {
  if (window.location.protocol === 'file:') return 'hash';
  if ((window.location.hash || '').startsWith('#/')) return 'hash';
  if (document.querySelector('a[href*=\"#/c/\"]')) return 'hash';
  return 'browser';
})()`);
console.log(`Router: ${routerKind}`);

// Same settle logic as cdp-verify.mjs: wait for the heading to *change* (navigation is
// async, so "a heading exists" can pass against stale content) and the spinner to clear.
const navigateAndSettle = async path => {
  const before = await currentHeading();
  if (routerKind === 'hash') {
    await evaluate(`window.location.hash = ${JSON.stringify('#' + path)}`);
  } else {
    const clicked = await evaluate(`(() => {
      const a = Array.from(document.querySelectorAll('a[href]'))
        .find(x => (x.getAttribute('href') || '').endsWith(${JSON.stringify(path)}));
      if (!a) return false;
      a.click();
      return true;
    })()`);
    if (!clicked) {
      await evaluate(`window.location.href = ${JSON.stringify(path)}`);
    }
  }
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
  const here = await evaluate('window.location.href');
  if (!here.includes(path.replace(/\/$/, ''))) {
    throw new Error(`Could not open ${path} (Headlamp is on ${here})`);
  }
};

// Crop to the viewport, so a bigger window adds no empty margin.
const capture = async file => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
    clip: { x: 0, y: 0, width: VIEWPORT_W, height: viewportHeight, scale: 1 },
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(data, 'base64'));
  console.log(`  wrote ${file}`);
};

// First `/c/<cluster>/…` link in the DOM — lets `npm run screenshots` work with no args.
// Matches both HashRouter (`#/c/…`) and BrowserRouter (`/c/…`) hrefs.
const discoverCluster = () =>
  evaluate(`(() => {
    const m0 = (window.location.pathname || '').match(/^\\/c\\/([^/]+)/);
    if (m0) return m0[1];
    const m = (window.location.hash || '').match(/^#\\/c\\/([^/]+)/);
    if (m) return m[1];
    const a = Array.from(document.querySelectorAll('a[href]'))
      .map(x => x.getAttribute('href') || '').find(h => h.includes('/c/'));
    const m2 = a && a.match(/(?:#)?\\/c\\/([^/]+)/);
    return m2 ? m2[1] : null;
  })()`);

const CLUSTER = clusterArg || (await discoverCluster()) || 'kind-headlamp-test';
console.log(`Cluster: ${CLUSTER}  (${VIEWPORT_W}x${VIEWPORT_H} @${SCALE}x -> ${OUT_DIR}/)`);
// Land in cluster context first: Headlamp only renders this plugin's routes/sidebar there.
await navigateAndSettle(`/c/${CLUSTER}/cnpg/status`);

// Headlamp's own theme setting can override ours, so check.
const isDark = await evaluate(`(() => {
  const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
})()`);
if (isDark !== (THEME === 'dark')) {
  throw new Error(
    `Headlamp shows the ${isDark ? 'dark' : 'light'} theme but ${THEME} was asked for. ` +
      `In Headlamp, open Settings > General > Theme, pick ${THEME === 'dark' ? 'Dark' : 'Light'} ` +
      `(or Use system) and run this again.`
  );
}

// Detail links: prefer the demo objects (stable names for stable shots), else first row link.
// Navigates to the list first — discovery reads the current DOM, so it must run there.
// Returned hrefs are plain paths, for navigateAndSettle.
const detailHrefFromList = async (listPath, preferred, regexSrc) => {
  await navigateAndSettle(listPath);
  return evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href') || '');
    const clean = h =>
      h.includes('#') ? h.slice(h.indexOf('#') + 1) : h.replace(/^[a-z]+:\\/\\/[^/]*/i, '');
    const pref = links.find(h => h.includes(${JSON.stringify(preferred)}));
    if (pref) return clean(pref);
    const re = new RegExp(${JSON.stringify(regexSrc)});
    const hit = links.find(h => re.test(h));
    return hit ? clean(hit) : null;
  })()`);
};

const shots = [
  {
    name: 'operator-status',
    run: async () => {
      await navigateAndSettle(`/c/${CLUSTER}/cnpg/status`);
      await capture(`${OUT_DIR}/operator-status.png`);
    },
  },
  {
    name: 'cluster-list',
    run: async () => {
      await navigateAndSettle(`/c/${CLUSTER}/cnpg/clusters`);
      await capture(`${OUT_DIR}/cluster-list.png`);
    },
  },
  {
    name: 'cluster-detail',
    run: async () => {
      const href = await detailHrefFromList(
        `/c/${CLUSTER}/cnpg/clusters`,
        '/cnpg/clusters/cnpg-demo/demo-pg-ha',
        '/cnpg/clusters/[^/]+/[^/]+$'
      );
      if (!href) throw new Error('no Cluster found — run screenshots/demo.sh create first?');
      await navigateAndSettle(href);
      await capture(`${OUT_DIR}/cluster-detail.png`);
    },
  },
  {
    name: 'cluster-logs',
    // Taller, so the log stream fits.
    height: 1500,
    run: async () => {
      const href = await detailHrefFromList(
        `/c/${CLUSTER}/cnpg/clusters`,
        '/cnpg/clusters/cnpg-demo/demo-pg-ha',
        '/cnpg/clusters/[^/]+/[^/]+$'
      );
      if (!href) throw new Error('no Cluster found — run screenshots/demo.sh create first?');
      await navigateAndSettle(href);
      // The Logs tab has no URL, so click it.
      const clicked = await evaluate(`(() => {
        const tab = Array.from(document.querySelectorAll('[role="tab"]'))
          .find(t => t.textContent.trim() === 'Logs');
        if (!tab) return false;
        tab.click();
        return true;
      })()`);
      if (!clicked) throw new Error('Logs tab not found on the cluster detail page');
      // Wait for log lines (the demo must have some).
      const ROWS = '[role="button"][aria-pressed]:not(.MuiChip-root)';
      const ready = await waitFor(
        `document.body.textContent.includes('Insights') &&
         document.querySelectorAll('${ROWS}').length >= 10`,
        { timeoutMs: 30000 }
      );
      if (!ready) {
        throw new Error('Logs tab showed no log lines — run screenshots/demo.sh traffic first?');
      }
      // Let the charts draw.
      await sleep(2000);
      // Show slow statements and app errors, and open a slow INSERT.
      for (const label of ['Slow statements', 'App errors']) {
        await evaluate(`Array.from(document.querySelectorAll('.MuiChip-root'))
          .find(c => c.textContent.trim().startsWith(${JSON.stringify(label)}))?.click()`);
        await sleep(400);
      }
      await sleep(400);
      const opened = await evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll('${ROWS}'));
        const row =
          rows.find(r => r.textContent.includes('duration:') && r.textContent.includes('INSERT INTO orders')) ||
          rows[0];
        if (!row) return false;
        row.click();
        return true;
      })()`);
      if (!opened) throw new Error('No log line to open');
      await waitFor(`!!document.querySelector('[aria-label="Log details"]')`, { timeoutMs: 5000 });
      await sleep(800);
      await capture(`${OUT_DIR}/cluster-logs.png`);
    },
  },
  {
    name: 'cluster-map',
    run: async () => {
      // The demo namespace on Headlamp's Map, with the Cluster expanded.
      await navigateAndSettle(`/c/${CLUSTER}/map?namespace=cnpg-demo`);
      const CHIP = `Array.from(document.querySelectorAll('.MuiChip-root')).find(c => c.textContent.trim() === 'Expand All')`;
      if (!(await waitFor(`!!(${CHIP})`, { timeoutMs: 20000 }))) {
        throw new Error('The Map did not load');
      }
      // Click it only when it is off (an "on" chip shows a check mark).
      await evaluate(`(() => { const c = ${CHIP}; if (!c.querySelector('svg')) c.click(); })()`);
      const ready = await waitFor(`document.querySelectorAll('.react-flow__node').length >= 10`, {
        timeoutMs: 20000,
      });
      if (!ready) throw new Error('Map shows no Cluster — run screenshots/demo.sh create first?');
      await evaluate(`document.querySelector('.react-flow__controls-fitview')?.click()`);
      await sleep(1500);
      await capture(`${OUT_DIR}/cluster-map.png`);
    },
  },
  {
    name: 'cluster-form',
    run: async () => {
      // The create form is a full route page (/cnpg/clusters/new), not an
      // Activity overlay — navigate to it directly (same as every other shot).
      await navigateAndSettle(`/c/${CLUSTER}/cnpg/clusters/new`);
      const ready = await waitFor(
        `document.body.textContent.includes('New Cluster') && document.body.textContent.includes('YAML Preview')`,
        { timeoutMs: 10000 }
      );
      if (!ready) throw new Error('create form page did not render');
      await sleep(800);
      await capture(`${OUT_DIR}/cluster-form.png`);
    },
  },
  {
    name: 'scheduled-backup-list',
    run: async () => {
      await navigateAndSettle(`/c/${CLUSTER}/cnpg/scheduledbackups`);
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
        await navigateAndSettle(`/c/${CLUSTER}/cnpg/databases`);
      } else {
        await navigateAndSettle(href);
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
  await setViewport(shot.height ?? VIEWPORT_H);
  await shot.run();
}
await setViewport(VIEWPORT_H);

ws.close();
console.log(`\nOK: ${selected.length} screenshot(s) in ${OUT_DIR}/`);
