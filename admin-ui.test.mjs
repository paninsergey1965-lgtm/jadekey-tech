import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = readFileSync(new URL('./live.html', import.meta.url), 'utf8');

test('scanner JavaScript remains parseable', () => {
  let count = 0;
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const opening = match[0].slice(0, match[0].indexOf('>') + 1);
    if (/type=["']module/.test(opening)) continue;
    new Script(match[1]);
    count += 1;
  }
  assert.ok(count >= 2);
});

test('administrator sections are hidden in the buyer view', () => {
  assert.match(html, /\.admin-quick,\.admin-dashboard,\.admin-note\{display:none\}/);
  assert.match(html, /body\.admin-mode \.admin-dashboard,body\.admin-mode \.admin-note\{display:block\}/);
  assert.equal((html.match(/id="clientsBtn"/g) || []).length, 1);
  for (const id of ['adminScanClients', 'adminLiveClients', 'adminNewStone']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`\\$\\('${id}'\\)\\.onclick`));
  }
});

test('switching admin mode changes only its visibility, not stone data', () => {
  const start = html.indexOf('function setAdmin(on) {');
  const end = html.indexOf('async function authHeaders()', start);
  assert.ok(start >= 0 && end > start);

  const styles = Object.fromEntries(['nColl', 'nAdd', 'dsBtn', 'soldBtn'].map(id => [id, { style: {} }]));
  const flags = new Set();
  const context = {
    document: { body: { classList: {
      toggle(name, enabled) { if (enabled) flags.add(name); else flags.delete(name); }
    } } },
    $: id => styles[id], dsSetup() {}, dsCount() {}, renderColl() {}, window: {}
  };
  runInNewContext(`let isAdmin = false; ${html.slice(start, end)}; setAdmin(false);`, context);
  assert.ok(!flags.has('admin-mode'));
  assert.equal(styles.nColl.style.display, 'none');
  assert.equal(styles.nAdd.style.display, 'none');

  runInNewContext('setAdmin(true);', context);
  assert.ok(flags.has('admin-mode'));
  assert.equal(styles.nColl.style.display, '');
  assert.equal(styles.nAdd.style.display, '');
});

test('saved credentials are validated before showing admin controls', () => {
  assert.match(html, /authToken\(\)\.then\(token =>/);
  assert.match(html, /claims\?\.email\?\.toLowerCase\(\) === ADMIN_EMAIL\.toLowerCase\(\)/);
  assert.doesNotMatch(html, /if \(localStorage\.getItem\('jk2_rt'\)\) \{ setAdmin\(true\)/);
});
