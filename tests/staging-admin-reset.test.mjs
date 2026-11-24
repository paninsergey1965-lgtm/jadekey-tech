import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The production module is intentionally browser-native JS, not a Node package.
const source = readFileSync(new URL('../jk-admin.js', import.meta.url), 'utf8');
const { initJadeKeyAdmin } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function harness({ side = false, privateRecord = false, patches = false, failCommit = false } = {}) {
  const project = 'jadekey-test';
  const root = `projects/${project}/databases/(default)/documents`;
  const db = new Map();
  const catalog = { id: 'catalog-1', jk: 'JK-000001', name: 'Каталог', g: 'print-1', mode: '', of: '' };
  const main = { id: 'live-1', name: 'Живой камень', g: 'print-1', mode: 'path', of: '', owner: 'buyer-1' };
  const second = { id: 'side-1', name: 'Живой камень', mode: 'path', of: 'live-1', owner: 'buyer-1' };
  for (const stone of [catalog, main, ...(side ? [second] : [])]) db.set(`${root}/jk2_stones/${stone.id}`, { ...stone });
  db.set(`${root}/jk2_patches/catalog-1`, { idx: 'print-patch' });
  if (patches) for (const stone of [main, ...(side ? [second] : [])]) db.set(`${root}/jk2_patches/${stone.id}`, { idx: 'live-patch' });
  if (privateRecord) db.set(`${root}/jk2_private/live-1`, { owner: 'buyer-1', profile: '{"name":"Тестовый покупатель"}' });
  db.set(`${root}/jk2_clients/buyer-1`, { owner: 'buyer-1', email: 'buyer@example.com', verified: true });

  let currentHtml = '', elements = new Map();
  let stones = [catalog, main, ...(side ? [second] : [])];
  const toFields = value => Object.fromEntries(Object.entries(value).map(([key, v]) => [key, typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) }]));
  const fromFs = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, v]) => [key, v.stringValue ?? v.booleanValue ?? v.doubleValue]));
  const calls = [], toasts = [];
  const ctx = {
    project, firebaseKey: 'staging-test-key', adminEmail: 'jadekey1965@gmail.com',
    modeNames: { path: 'Путь', love: 'Love', mem: 'Память' },
    isAdmin: () => true, getAdminToken: async () => 'staging-admin-token',
    getStones: () => stones, fromFs, esc: value => String(value ?? ''),
    hideSheet: () => {}, toast: message => toasts.push(message),
    loadStones: async () => {
      stones = [...db].filter(([name]) => name.includes('/jk2_stones/')).map(([, value]) => ({ ...value }));
    },
    sheet: html => {
      currentHtml = html;
      elements = new Map([...html.matchAll(/id="([a-zA-Z0-9]+)"/g)].map(([, id]) => [id, {
        id, value: 'path', style: {}, disabled: false, textContent: '', onclick: null
      }]));
    }
  };
  const document = {
    getElementById: id => elements.get(id) ?? null,
    querySelectorAll: selector => {
      if (selector === '#cliRows [data-uid]') return currentHtml.includes('data-uid="buyer-1"') ? [{ dataset: { uid: 'buyer-1' }, onclick: null }] : [];
      if (selector === '#sheet [data-stone]') return currentHtml.includes('data-stone="live-1"') ? [{ dataset: { stone: 'live-1' }, onclick: null }] : [];
      return [];
    }
  };
  // Query selectors return elements whose handlers are used for navigation.
  const originalSelector = document.querySelectorAll;
  let uidButton, stoneButton;
  document.querySelectorAll = selector => {
    if (selector === '#cliRows [data-uid]') return uidButton = originalSelector(selector);
    if (selector === '#sheet [data-stone]') return stoneButton = originalSelector(selector);
    return [];
  };

  async function fetch(url, options) {
    const pathname = new URL(url).pathname;
    assert.ok(pathname.includes(`/projects/${project}/`), 'only staging Firestore may be called');
    const name = decodeURIComponent(pathname.slice(pathname.indexOf('/projects/') + 1));
    if (options.method === 'GET' && name.endsWith('/jk2_clients')) {
      return new Response(JSON.stringify({ documents: [{ name: `${root}/jk2_clients/buyer-1`, fields: toFields(db.get(`${root}/jk2_clients/buyer-1`)) }] }));
    }
    if (options.method === 'GET') {
      const value = db.get(name);
      return new Response(JSON.stringify(value ? { fields: toFields(value) } : { error: { message: 'not found' } }), { status: value ? 200 : 404 });
    }
    if (options.method === 'POST' && name.endsWith('/documents:commit')) {
      const { writes } = JSON.parse(options.body);
      calls.push(writes);
      if (failCommit) return new Response(JSON.stringify({ error: { message: 'permission denied' } }), { status: 403 });
      for (const write of writes) {
        const key = write.delete || write.update?.name;
        if (write.currentDocument?.exists === true && !db.has(key)) {
          return new Response(JSON.stringify({ error: { message: `missing ${key}` } }), { status: 400 });
        }
        if (write.currentDocument?.exists === false && db.has(key)) {
          return new Response(JSON.stringify({ error: { message: 'duplicate audit' } }), { status: 400 });
        }
      }
      for (const write of writes) {
        if (write.delete) db.delete(write.delete);
        if (write.update) db.set(write.update.name, fromFs(write.update.fields));
      }
      return new Response(JSON.stringify({ writeResults: writes.map(() => ({})) }));
    }
    throw new Error(`Unexpected request ${options.method} ${name}`);
  }

  async function navigateToStone() {
    await initJadeKeyAdmin(ctx).open();
    assert.equal(uidButton?.length, 1);
    uidButton[0].onclick();
    assert.equal(stoneButton?.length, 1);
    stoneButton[0].onclick();
    assert.doesNotMatch(currentHtml, /Передать другому клиенту|cliTransfer/);
  }
  return { db, root, document, fetch, ctx, calls, toasts, navigateToStone, getHtml: () => currentHtml };
}

async function withBrowser(h, callback, answer = 'СБРОС') {
  const old = { document: globalThis.document, fetch: globalThis.fetch, prompt: globalThis.prompt };
  globalThis.document = h.document;
  globalThis.fetch = h.fetch;
  globalThis.prompt = () => answer;
  try { await callback(); }
  finally { Object.assign(globalThis, old); }
}

test('admin reset succeeds when optional private data and live patches are absent', async () => {
  const h = harness();
  await withBrowser(h, async () => {
    await h.navigateToStone();
    await h.document.getElementById('cliReset').onclick();
    assert.ok(h.toasts.includes('Активация сброшена, каталог сохранён'));
    assert.ok(!h.db.has(`${h.root}/jk2_stones/live-1`));
    assert.ok(h.db.has(`${h.root}/jk2_stones/catalog-1`));
    assert.ok(h.db.has(`${h.root}/jk2_patches/catalog-1`));
    assert.ok(h.db.has(`${h.root}/jk2_clients/buyer-1`));
    const writes = h.calls[0];
    assert.equal(writes.filter(w => w.currentDocument?.exists === true).length, 1);
    assert.equal(writes.find(w => w.delete?.endsWith('/jk2_stones/live-1'))?.currentDocument?.exists, true);
    assert.ok(writes.some(w => w.update?.name.includes('/jk2_adminlog/') && w.update.fields.action.stringValue === 'reset'));
    assert.match(h.getHtml(), /Камни не найдены/);
  });
});

test('admin reset clears both activated sides and profile, while keeping the catalog', async () => {
  const h = harness({ side: true, privateRecord: true, patches: true });
  await withBrowser(h, async () => {
    await h.navigateToStone();
    await h.document.getElementById('cliReset').onclick();
    for (const collection of ['jk2_stones', 'jk2_patches']) for (const id of ['live-1', 'side-1']) assert.ok(!h.db.has(`${h.root}/${collection}/${id}`));
    assert.ok(!h.db.has(`${h.root}/jk2_private/live-1`));
    assert.ok(h.db.has(`${h.root}/jk2_stones/catalog-1`));
    assert.ok(h.db.has(`${h.root}/jk2_patches/catalog-1`));
  });
});

test('failed reset stays visible on the sheet and leaves all stone data intact', async () => {
  const h = harness({ privateRecord: true, failCommit: true });
  await withBrowser(h, async () => {
    await h.navigateToStone();
    await h.document.getElementById('cliReset').onclick();
    assert.ok(h.db.has(`${h.root}/jk2_stones/live-1`));
    assert.ok(h.db.has(`${h.root}/jk2_private/live-1`));
    assert.match(h.document.getElementById('cliResetStatus').textContent, /permission denied/);
    assert.equal(h.document.getElementById('cliReset').disabled, false);
    assert.doesNotMatch(h.toasts.join(' '), /Активация сброшена/);
  });
});

test('reset requires exact confirmation and does not write on cancellation', async () => {
  const h = harness();
  await withBrowser(h, async () => {
    await h.navigateToStone();
    await h.document.getElementById('cliReset').onclick();
    assert.equal(h.calls.length, 0);
    assert.ok(h.db.has(`${h.root}/jk2_stones/live-1`));
  }, 'нет');
});
