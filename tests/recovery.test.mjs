import test from 'node:test';
import assert from 'node:assert/strict';
import { initJadeKeyAccounts } from '../jk-accounts.js';

const original = {};
for (const key of ['localStorage', 'fetch', 'confirm', 'document']) original[key] = globalThis[key];

function testBrowser() {
  const saved = new Map();
  const writes = [];
  globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem(key, value) { writes.push([key, value]); saved.set(key, value); },
    removeItem: key => saved.delete(key)
  };
  globalThis.document = { getElementById: () => null };
  globalThis.confirm = () => true;
  return { saved, writes };
}

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function makeContext({ userUid = 'owner-1', owned = true } = {}) {
  let token = userUid ? 'anonymous-token' : null;
  let uid = userUid;
  const notices = [], sessions = [], stoneLoads = [];
  const documents = [];
  const ctx = {
    firebaseKey: 'test-key',
    anonToken: async create => {
      if (!token && create) { uid = 'new-buyer'; token = 'new-anon-token'; }
      return token;
    },
    myUid: () => uid,
    setSession(result) { sessions.push(result); token = result.idToken; uid = result.localId; },
    refreshSession: async () => { token = 'fresh-verified-token'; return token; },
    fsReq: async (method, path, _token, fields) => {
      if (method === 'GET') { const error = new Error('missing'); error.status = 404; throw error; }
      documents.push({ method, path, fields });
    },
    getStones: () => owned && uid ? [{ mode: 'tal', of: '', owner: uid }] : [],
    loadStones: async () => { stoneLoads.push(uid); },
    liveHome: async () => {}, showLiveTab: () => {}, esc: value => value,
    toast: message => { notices.push(message); }
  };
  return { ctx, notices, sessions, documents, stoneLoads, get uid() { return uid; } };
}

test('registration links an anonymous stone owner to email/password without changing UID or writing password locally', async () => {
  const browser = testBrowser();
  const fixture = makeContext();
  let linked = null, verification = null;
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    if (url.includes('accounts:lookup')) return response({ users: [{ localId: 'owner-1' }] });
    if (url.includes('accounts:update')) {
      linked = payload;
      return response({ idToken: 'linked-token', refreshToken: 'linked-refresh', localId: 'owner-1', expiresIn: '3600' });
    }
    if (url.includes('accounts:sendOobCode')) {
      verification = payload;
      return response({ email: 'sergei@example.com' });
    }
    throw Error(`Unexpected fetch: ${url}`);
  };

  const recovery = initJadeKeyAccounts(fixture.ctx);
  await recovery.registerEmail(' SERGEI@Example.com ', 'long-private-password', 'long-private-password');
  assert.deepEqual(linked, {
    idToken: 'anonymous-token', email: 'sergei@example.com',
    password: 'long-private-password', returnSecureToken: true
  });
  assert.deepEqual(verification, { requestType: 'VERIFY_EMAIL', idToken: 'linked-token' });
  assert.equal(fixture.uid, 'owner-1');
  assert.equal(fixture.sessions.length, 1);
  assert.equal(fixture.documents.length, 0, 'no client profile before verification');
  assert.equal(browser.writes.length, 0, 'module must not save passwords or emails in localStorage');
  assert.match(fixture.notices.join(' '), /подтверди почту/i);
});

test('a new buyer may register before activating the first stone', async () => {
  testBrowser();
  const fixture = makeContext({ userUid: null, owned: false });
  let linkToken = null;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('accounts:lookup')) return response({ users: [{ localId: 'new-buyer' }] });
    if (url.includes('accounts:update')) {
      linkToken = body.idToken;
      return response({ idToken: 'buyer-id-token', refreshToken: 'buyer-refresh', localId: 'new-buyer' });
    }
    if (url.includes('accounts:sendOobCode')) return response({});
    throw Error(`Unexpected call: ${url}`);
  };
  await initJadeKeyAccounts(fixture.ctx).registerEmail('buyer@example.com', 'buyer-password', 'buyer-password');
  assert.equal(linkToken, 'new-anon-token');
  assert.equal(fixture.uid, 'new-buyer');
});

test('server-confirmed email with refreshed token indexes client, never an unverified address', async () => {
  testBrowser();
  const fixture = makeContext();
  const seenTokens = [];
  globalThis.fetch = async (url, options) => {
    if (!url.includes('accounts:lookup')) throw Error('Unexpected call');
    const { idToken } = JSON.parse(options.body);
    seenTokens.push(idToken);
    return response({ users: [{ localId: 'owner-1', email: 'sergei@example.com', emailVerified: true }] });
  };
  await initJadeKeyAccounts(fixture.ctx).checkVerification();
  assert.deepEqual(seenTokens, ['fresh-verified-token']);
  assert.deepEqual(fixture.documents, [{ method: 'POST', path: 'jk2_clients?documentId=owner-1', fields: {
    owner: 'owner-1', email: 'sergei@example.com', verified: true, updated: fixture.documents[0].fields.updated
  } }]);
  assert.match(fixture.notices.join(' '), /Почта подтверждена/);
});

test('login on a different phone restores original UID and its stones', async () => {
  testBrowser();
  const fixture = makeContext({ userUid: null, owned: false });
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('accounts:signInWithPassword')) {
      assert.deepEqual(body, { email: 'sergei@example.com', password: 'private-password', returnSecureToken: true });
      return response({ idToken: 'restored-id', refreshToken: 'restored-refresh', localId: 'owner-1' });
    }
    if (url.includes('accounts:lookup')) return response({ users: [{ localId: 'owner-1', email: 'sergei@example.com', emailVerified: true }] });
    throw Error(`Unexpected call: ${url}`);
  };
  await initJadeKeyAccounts(fixture.ctx).signIn('sergei@example.com', 'private-password');
  assert.equal(fixture.uid, 'owner-1');
  assert.deepEqual(fixture.stoneLoads, ['owner-1']);
  assert.equal(fixture.documents.length, 1);
});

test('incorrect password cannot replace active stone owner or create client record', async () => {
  testBrowser();
  const fixture = makeContext();
  globalThis.fetch = async (url) => {
    if (url.includes('accounts:signInWithPassword')) return response({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
    throw Error('Unexpected request');
  };
  await initJadeKeyAccounts(fixture.ctx).signIn('someone@example.com', 'wrong-password');
  assert.equal(fixture.uid, 'owner-1');
  assert.equal(fixture.sessions.length, 0);
  assert.equal(fixture.documents.length, 0);
  assert.match(fixture.notices.join(' '), /Неверная почта или пароль/);
});

test('expired owner session must not accidentally create a new UID while registering', async () => {
  testBrowser();
  const fixture = makeContext();
  fixture.ctx.anonToken = async create => { assert.equal(create, false); return null; };
  let called = false;
  globalThis.fetch = async () => { called = true; throw Error('Must not contact Firebase'); };
  await initJadeKeyAccounts(fixture.ctx).registerEmail('sergei@example.com', 'long-password', 'long-password');
  assert.equal(called, false);
  assert.equal(fixture.uid, 'owner-1');
});

test('password reset sends a reset email and never logs the password', async () => {
  const browser = testBrowser();
  const fixture = makeContext({ userUid: null, owned: false });
  let request = null;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /accounts:sendOobCode/);
    request = JSON.parse(options.body);
    return response({});
  };
  await initJadeKeyAccounts(fixture.ctx).resetPassword('buyer@example.com');
  assert.deepEqual(request, { requestType: 'PASSWORD_RESET', email: 'buyer@example.com' });
  assert.equal(browser.writes.length, 0);
  assert.match(fixture.notices.join(' '), /письмо для смены пароля/);
});

test.after(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
