import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { initJadeKeyAccounts } from '../jk-accounts.js';

const original = {};
for (const key of ['localStorage', 'location', 'history', 'fetch', 'alert', 'prompt', 'document']) original[key] = globalThis[key];

function fakeBrowser(url, pending = null) {
  const saved = new Map();
  if (pending) saved.set('jk2_email_pending', JSON.stringify(pending));
  let replaced = null;
  globalThis.localStorage = {
    getItem: k => saved.get(k) ?? null,
    setItem: (k, value) => saved.set(k, value),
    removeItem: k => saved.delete(k)
  };
  globalThis.location = { href: url };
  globalThis.history = { replaceState: (_s, _t, url) => { replaced = url; } };
  globalThis.alert = () => {};
  globalThis.prompt = () => { throw Error('No prompt expected'); };
  globalThis.document = { getElementById: () => null };
  return { saved, get replaced() { return replaced; } };
}

test('email link upgrades anonymous account without changing owner UID', async () => {
  const browser = fakeBrowser('https://jadekey.tech/scan.html?jk_email_flow=link&mode=signIn&oobCode=once', {
    email: 'sergei@example.com', mode: 'link', uid: 'owner-1', sentAt: Date.now()
  });
  let token = 'anonymous-id-token', uid = 'owner-1';
  let completion = null, created = null, opened = 0;
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    if (url.includes('accounts:signInWithEmailLink')) {
      completion = payload;
      return { ok: true, json: async () => ({ idToken: 'linked-id-token', refreshToken: 'linked-refresh', localId: 'owner-1', expiresIn: '3600' }) };
    }
    if (url.includes('accounts:lookup')) {
      assert.equal(payload.idToken, 'linked-id-token');
      return { ok: true, json: async () => ({ users: [{ localId: 'owner-1', email: 'sergei@example.com', emailVerified: true }] }) };
    }
    throw Error(`Unexpected fetch: ${url}`);
  };
  const ctx = {
    firebaseKey: 'mock-key', anonToken: async () => token, myUid: () => uid,
    setSession(result) { token = result.idToken; uid = result.localId; },
    fsReq: async (method, path, _token, data) => {
      if (method === 'GET') { const err = new Error('missing'); err.status = 404; throw err; }
      created = { method, path, data };
    },
    getStones: () => [{ mode: 'path', of: '', owner: uid }],
    loadStones: async () => {}, liveHome: async () => {}, showLiveTab: () => { opened++; },
    esc: x => x, toast: msg => { throw Error(`Unexpected toast: ${msg}`); }
  };
  const account = initJadeKeyAccounts(ctx);
  assert.equal(await account.handleEmailReturn(), true);
  assert.deepEqual(completion, { email: 'sergei@example.com', oobCode: 'once', idToken: 'anonymous-id-token' });
  assert.equal(uid, 'owner-1');
  assert.equal(created.method, 'POST');
  assert.equal(created.path, 'jk2_clients?documentId=owner-1');
  assert.equal(created.data.email, 'sergei@example.com');
  assert.equal(browser.saved.get('jk2_email_pending'), undefined);
  assert.equal(browser.replaced, '/scan.html');
  assert.equal(opened, 1);
});

test('a link on a new browser cannot silently replace the original owner', async () => {
  fakeBrowser('https://jadekey.tech/scan.html?jk_email_flow=link&mode=signIn&oobCode=once');
  let calls = 0, warning = '';
  globalThis.fetch = async () => { calls++; throw Error('Must not contact Firebase'); };
  const account = initJadeKeyAccounts({
    firebaseKey: 'mock-key', myUid: () => null,
    toast: message => { warning = message; }
  });
  assert.equal(await account.handleEmailReturn(), true);
  assert.match(warning, /браузере, где находится камень/);
  assert.equal(calls, 0);
});

test('email handler only forwards one-time code to same-origin scanner', () => {
  const html = readFileSync(new URL('../email-action.html', import.meta.url), 'utf8');
  const source = /<script>([\s\S]+?)<\/script>/.exec(html)?.[1];
  assert.ok(source);
  const calls = [], status = { textContent: '', append() {} };
  const location = {
    href: 'https://jadekey.tech/email-action.html', origin: 'https://jadekey.tech',
    search: '?mode=signIn&oobCode=ABC&continueUrl=' + encodeURIComponent('https://jadekey.tech/scan.html?jk_email_flow=link'),
    replace: url => calls.push(url)
  };
  vm.runInNewContext(source, { location, URL, URLSearchParams,
    document: { getElementById: () => status, createElement: () => ({}) }
  });
  const sent = new URL(calls[0]);
  assert.equal(sent.searchParams.get('oobCode'), 'ABC');
  assert.equal(sent.searchParams.get('jk_email_flow'), 'link');

  calls.length = 0;
  location.search = '?mode=signIn&oobCode=ABC&continueUrl=' + encodeURIComponent('https://evil.example/scan.html');
  vm.runInNewContext(source, { location, URL, URLSearchParams,
    document: { getElementById: () => status, createElement: () => ({ href: '', textContent: '' }) }
  });
  assert.equal(calls.length, 0);
  assert.match(status.textContent, /Некорректный адрес/);
});

test.after(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
