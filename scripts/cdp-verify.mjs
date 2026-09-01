#!/usr/bin/env node
/**
 * Live-load smoke check for this plugin, driven over the Chrome DevTools Protocol.
 *
 * A green `tsc` / `lint` / `build` does not prove a Headlamp plugin loads. A value imported from a
 * path that isn't externalized at runtime resolves to `undefined` and throws on load, while the
 * build stays green — and a wrong `sidebar:` reference doesn't throw at all, it just silently
 * stops highlighting the entry. Only loading the plugin in a real Headlamp catches either.
 *
 * This talks to Headlamp's DevTools endpoint directly (HTTP + WebSocket on :9222) using node's
 * built-in WebSocket, so it needs no dependencies.
 *
 * Usage:
 *   1. npm start                                   # watch build, deploys into Headlamp
 *   2. in the Headlamp checkout:
 *      npm run start:with-app:debug                # backend :4466, vite :3000, Electron :9222
 *   3. node scripts/cdp-verify.mjs [cluster-name]  # default: kind-headlamp-test
 *                                                  # or set HEADLAMP_CLUSTER
 *
 * Exits non-zero if the plugin failed to load or a route rendered nothing.
 */

const CDP_HTTP = process.env.CDP_URL || 'http://localhost:9222';
const CLUSTER = process.argv[2] || process.env.HEADLAMP_CLUSTER || 'kind-headlamp-test';

const targets = await (await fetch(`${CDP_HTTP}/json`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) {
  console.error(
    `No page target on ${CDP_HTTP} — is Headlamp running with --remote-debugging-port?`
  );
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const consoleEntries = [];
const exceptions = [];

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleEntries.push({
      level: msg.params.type,
      text: msg.params.args.map(a => a.value ?? a.description ?? a.type).join(' '),
    });
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    exceptions.push(d.exception?.description ?? d.text);
  }
  if (msg.method === 'Log.entryAdded') {
    consoleEntries.push({ level: msg.params.entry.level, text: msg.params.entry.text });
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async expression => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate threw');
  }
  return r.result.value;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Polls `conditionExpr` (a JS expression evaluated in the page) until it's truthy, instead of
// hoping a fixed sleep was long enough. Headlamp's sidebar expand state is Redux-driven (a
// `setSidebarSelected` dispatch after the route mounts), and how long that takes depends on
// machine load — CI runners are slower and less consistent than a local dev box, so a fixed sleep
// that's comfortable locally can still race the render there.
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
await send('Log.enable');
await send('Page.enable');

// Reload so plugin load-time console output is captured from the start.
await send('Page.reload', { ignoreCache: true });
await sleep(9000);

const routes = [
  ['Status', `/c/${CLUSTER}/cnpg/status`],
  ['Clusters list', `/c/${CLUSTER}/cnpg/clusters`],
  ['Backups list', `/c/${CLUSTER}/cnpg/backups`],
  ['Databases list', `/c/${CLUSTER}/cnpg/databases`],
  ['Poolers list', `/c/${CLUSTER}/cnpg/poolers`],
  ['ScheduledBackups list', `/c/${CLUSTER}/cnpg/scheduledbackups`],
  ['Publications list', `/c/${CLUSTER}/cnpg/publications`],
  ['Subscriptions list', `/c/${CLUSTER}/cnpg/subscriptions`],
  ['DatabaseRoles list', `/c/${CLUSTER}/cnpg/databaseroles`],
  ['ImageCatalogs list', `/c/${CLUSTER}/cnpg/imagecatalogs`],
  ['ClusterImageCatalogs list', `/c/${CLUSTER}/cnpg/clusterimagecatalogs`],
  ['ObjectStores list', `/c/${CLUSTER}/cnpg/objectstores`],
];

// Headlamp only renders this plugin's sidebar tree once inside a cluster context — a reload can
// land back on the cluster chooser, where the in-cluster sidebar (and thus these entries) isn't in
// the DOM at all yet. Navigate in before checking, same as the first ROUTES iteration below does.
await evaluate(`window.location.hash = ${JSON.stringify('#/c/' + CLUSTER + '/cnpg/status')}`);

// Sidebar entries render via ListItemButton with `component: renderLink` (ListItemLink.js), which
// swaps the root DOM tag to a react-router Link — i.e. an <a href>, not a <button>. Only the
// surrounding DefaultLinkArea controls (Create/version/collapse) are real <button>s, so a
// button-only query finds those three and none of the actual nav entries — ours or Headlamp's own.
// The collapsed icon-only rail additionally drops the visible <ListItemText> entirely (SidebarItem
// passes `primary: fullWidth ? label : ''`) and keeps the label only as `aria-label` — so fall back
// to aria-label there too.
const labelOf = `b => (b.getAttribute('aria-label') || b.innerText || '').replace(/\\n/g, ' ').trim()`;
const itemSelector = `'a[href], button'`;
const HEADING_SELECTOR = 'h1, h2, [class*="SectionHeader"]';

const currentHeading = () =>
  evaluate(`(() => {
    const h = document.querySelector('${HEADING_SELECTOR}');
    return h ? h.textContent.trim() : null;
  })()`);

// Sets the hash and waits for the page to actually settle on the new route, rather than checking
// once right after the assignment. `hashchange` fires asynchronously, so the previous route's
// heading can still be in the DOM on the first poll — waiting only for "a heading exists" can pass
// immediately against stale content. Waiting for the heading text to change (not just re-appear)
// catches that, and waiting for the loading spinner to clear too means rows/sections are read from
// fetched data instead of the pre-fetch state. If this navigates to the route already showing
// (heading unchanged by design), it harmlessly rides out the timeout — correctness isn't affected,
// since the already-settled state is what gets read either way.
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
    { timeoutMs: 10000 }
  );
};

// Collected up front so the sidebar check below can fail the run the same way an empty route does,
// instead of only logging and letting the script exit 0.
const emptyRoutes = [];

// The top-level 'CloudNativePG' entry is always in the DOM, but its children (including 'Postgres
// Clusters') only mount once Redux has processed the route's sidebar selection and marked it
// expanded (Headlamp's sidebar Collapse uses unmountOnExit) — that lags the URL change, so poll for
// the actual target label rather than guessing a fixed delay.
const sidebarReady = await waitFor(`(() => {
  const labelOf = ${labelOf};
  return Array.from(document.querySelectorAll('nav')).some(n =>
    Array.from(n.querySelectorAll(${itemSelector})).some(b => labelOf(b) === 'Postgres Clusters')
  );
})()`);
if (!sidebarReady) {
  console.error('Timed out waiting for the "Postgres Clusters" sidebar entry to appear.');
  emptyRoutes.push('Sidebar (Postgres Clusters entry)');
}

console.log('=== SIDEBAR ===');
const sidebar = await evaluate(`(() => {
  const labelOf = ${labelOf};
  const navs = Array.from(document.querySelectorAll('nav'));
  const nav = navs.find(n => Array.from(n.querySelectorAll(${itemSelector})).some(b => labelOf(b) === 'Postgres Clusters'));
  if (!nav) {
    // Diagnostics: what IS actually in the DOM at this point, so a mismatch (wrong label text,
    // wrong element type, plugin entries missing entirely, ...) is visible instead of guessed at.
    const debug = navs.map((n, i) => ({
      nav: i,
      navAriaLabel: n.getAttribute('aria-label'),
      itemCount: n.querySelectorAll(${itemSelector}).length,
      labels: Array.from(n.querySelectorAll(${itemSelector})).slice(0, 40).map(labelOf).filter(Boolean),
    }));
    return 'plugin sidebar entries NOT FOUND\\n' + JSON.stringify(debug, null, 1);
  }
  const seen = new Set();
  const out = [];
  nav.querySelectorAll(${itemSelector}).forEach(b => {
    const text = labelOf(b);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(/Mui-selected/.test((b.className || '').toString()) ? text + ' [selected]' : text);
  });
  return out.join(' | ');
})()`);
console.log(sidebar);

console.log('\n=== ROUTES ===');
for (const [label, path] of routes) {
  await navigateAndSettle('#' + path);
  const info = await evaluate(`(() => {
    const hasSpinner = !!document.querySelector('[role="progressbar"]');
    const h = document.querySelector('${HEADING_SELECTOR}');
    const rows = document.querySelectorAll('table tbody tr').length;
    const labelOf = ${labelOf};
    const nav = Array.from(document.querySelectorAll('nav'))
      .find(n => Array.from(n.querySelectorAll(${itemSelector})).some(b => labelOf(b) === 'Postgres Clusters'));
    const highlighted = nav
      ? [...new Set(Array.from(nav.querySelectorAll(${itemSelector}))
          .filter(b => /Mui-selected/.test((b.className || '').toString()))
          .map(labelOf))]
      : [];
    const sections = Array.from(document.querySelectorAll('h2, h3, [class*="SectionBox"] h6'))
      .map(e => (e.textContent || '').trim()).filter(Boolean);
    return JSON.stringify({
      heading: h ? h.textContent.trim().slice(0, 40) : null,
      rows, hasSpinner,
      highlighted,
      sections: sections.slice(0, 14),
    });
  })()`);
  console.log(`\n-- ${label}  [${path}]`);
  console.log('   ' + info);
  if (!JSON.parse(info).heading) {
    emptyRoutes.push(label);
  }
}

// A Cluster detail page exercises the most code (sections, related-resource lookups), so visit a
// real one rather than a fixed name — whichever the list happens to hold.
console.log('\n=== CLUSTER DETAIL (first cluster in the list) ===');
await navigateAndSettle(`#/c/${CLUSTER}/cnpg/clusters`);
const detailHref = await evaluate(`(() => {
  const a = Array.from(document.querySelectorAll('a[href]'))
    .find(x => /\\/cnpg\\/clusters\\/[^/]+\\/[^/]+$/.test(x.getAttribute('href') || ''));
  return a ? a.getAttribute('href') : null;
})()`);
if (!detailHref) {
  console.log('   (no clusters in this namespace — detail page not exercised)');
} else {
  await navigateAndSettle(detailHref);
  console.log(
    '   ' +
      (await evaluate(`(() => {
    const h = document.querySelector('${HEADING_SELECTOR}');
    const sections = Array.from(document.querySelectorAll('h2, h3, [class*="SectionBox"] h6'))
      .map(e => (e.textContent || '').trim()).filter(Boolean);
    return JSON.stringify({
      href: ${JSON.stringify(detailHref)},
      heading: h ? h.textContent.trim().slice(0, 40) : null,
      sections: [...new Set(sections)].slice(0, 14),
    });
  })()`))
  );
}

console.log('\n=== A11Y: unnamed interactive controls ===');
const a11y = await evaluate(`(() => {
  const bad = [];
  document.querySelectorAll('button, a, [role="button"]').forEach(el => {
    const name = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim();
    if (!name) bad.push(el.outerHTML.slice(0, 110));
  });
  return JSON.stringify({ count: bad.length, samples: bad.slice(0, 6) }, null, 1);
})()`);
console.log(a11y);

console.log('\n=== CONSOLE (errors/warnings) ===');
const noisy = consoleEntries.filter(e => /error|warning/i.test(e.level));
console.log(
  noisy.length ? noisy.map(e => `[${e.level}] ${e.text}`.slice(0, 260)).join('\n') : '(none)'
);

console.log('\n=== PLUGIN EXECUTION ERRORS ===');
const pluginErrors = consoleEntries
  .concat(exceptions.map(t => ({ level: 'exception', text: t })))
  .filter(e => /Plugin execution error|cnpg/i.test(e.text));
console.log(
  pluginErrors.length
    ? pluginErrors.map(e => `[${e.level}] ${e.text}`.slice(0, 300)).join('\n')
    : '(none)'
);

console.log('\n=== UNCAUGHT EXCEPTIONS ===');
console.log(exceptions.length ? exceptions.map(e => e.slice(0, 260)).join('\n---\n') : '(none)');

ws.close();

// Only this plugin's own load failures should fail the run — other installed plugins share the
// console, and their crashes are not this plugin's problem.
const pluginName = 'cnpg-headlamp-plugin';
const ownFailure = consoleEntries
  .concat(exceptions.map(t => ({ level: 'exception', text: t })))
  .find(e => new RegExp(`Plugin execution error in [^\\n]*${pluginName}`).test(e.text));

if (ownFailure) {
  console.error(`\nFAILED: ${pluginName} did not load — ${ownFailure.text.slice(0, 200)}`);
  process.exit(1);
}
if (emptyRoutes.length) {
  console.error(`\nFAILED: route(s) rendered no content: ${emptyRoutes.join(', ')}`);
  process.exit(1);
}
console.log(`\nOK: ${pluginName} loaded, all routes rendered.`);
