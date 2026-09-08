const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../packages/core/src/privacy-mirror-core.js');
const Sanitizer = require('../packages/ai/src/evidence-sanitizer.js');
const origin = 'https://privacy-mirror-analysis-blazetiger10-5946s-projects.vercel.app';
function harness() {
  let handler;
  const session = { 'pmDashboardSource:99': 7 };
  const storage = { get: async key => ({ [key]: session[key] }), set: async data => Object.assign(session, data) };
  const adapter = { storageSession: storage, storageLocal: storage, queryTabs: async () => [{ id: 7, url: 'https://source.example/path' }, { id: 99, url: origin + '/dashboard/index.html' }], onMessage: fn => { handler = fn; }, onRequest() {}, onNavigation() {}, configurePanel() {} };
  const context = { PrivacyMirrorCore: Core, PrivacyMirrorEvidenceSanitizer: Sanitizer, PrivacyMirrorBrowserAdapter: adapter, chrome: { runtime: { getURL: path => 'chrome-extension://unit/' + path } }, URL, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(fs.readFileSync('apps/extension-shared/background.js', 'utf8'), context);
  return (message, sender) => new Promise(resolve => handler(message, sender, resolve));
}
test('authorized web dashboard reads source tab rather than resetting it to dashboard origin', async () => {
  const send = harness();
  const response = await send({ type: 'PM_DASHBOARD_REQUEST', request: { type: 'PM_GET_REPORT', tabId: 99 } }, { url: origin + '/dashboard/index.html', frameId: 0, tab: { id: 99, url: origin + '/dashboard/index.html' } });
  assert.equal(response.report.site, 'source.example');
});
test('web dashboard rejects wrong origin, unopened tab and unapproved operations', async () => {
  const send = harness();
  const sender = { url: origin + '/dashboard/index.html', frameId: 0, tab: { id: 99 } };
  const message = { type: 'PM_DASHBOARD_REQUEST', request: { type: 'PM_GET_HISTORY' } };
  assert.equal((await send(message, { ...sender, url: 'https://untrusted.example/' })).error, 'unauthorized');
  assert.equal((await send(message, { ...sender, tab: { id: 100 } })).error, 'open-from-extension');
  assert.equal((await send({ ...message, request: { type: 'PM_SET_POLICY' } }, sender)).error, 'unauthorized');
});

test('localhost connects explicitly and retrieves source report and stored history', async () => {
  const send = harness();
  const sender = { url: 'http://127.0.0.1:4173/dashboard/index.html', frameId: 0, tab: { id: 100 } };
  const call = type => send({ type: 'PM_DASHBOARD_REQUEST', request: { type } }, sender);
  assert.equal((await call('PM_CONNECT_DASHBOARD')).ok, true);
  assert.equal((await call('PM_GET_REPORT')).report.site, 'source.example');
  assert.ok((await call('PM_GET_HISTORY')).history);
});
test('local bridge rejects other ports, paths and frames', async () => {
  const send = harness();
  for (const [url, frameId] of [['http://127.0.0.1:8888/dashboard/index.html', 0], ['http://127.0.0.1:4173/untrusted.html', 0], ['http://127.0.0.1:4173/dashboard/index.html', 1]]) {
    const response = await send({ type: 'PM_DASHBOARD_REQUEST', request: { type: 'PM_CONNECT_DASHBOARD' } }, { url, frameId, tab: { id: 100 } });
    assert.equal(response.error, 'unauthorized');
  }
});
