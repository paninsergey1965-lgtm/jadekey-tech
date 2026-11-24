import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(readFileSync(path.join(root, 'firebase/staging-hosting/firebase.json'), 'utf8'));

test('Firebase Hosting deploy is explicitly restricted to the test site', () => {
  assert.equal(cfg.hosting.site, 'jadekey-test');
  assert.equal(cfg.hosting.public, 'public');
  assert.equal(cfg.firestore, undefined);
  assert.equal(cfg.functions, undefined);
  assert.equal(cfg.hosting.rewrites, undefined);
  assert.ok(cfg.hosting.headers.some(entry => entry.headers.some(header =>
    header.key === 'X-Robots-Tag' && header.value.includes('noindex'))));
});

test('generated Hosting files are only the explicitly reviewed public allowlist', () => {
  const allowed = new Set([
    'index.html', 'robots.txt', 'scan.html', 'live.html', 'email-action.html',
    'jk-accounts.js', 'jk-admin.js', 'privacy.html', 'pamyat.html',
    'luna.html', 'psalter.json', 'manifest.webmanifest', 'coi-sw.js',
    'vendor/transformers.min.js', 'vendor/ort-wasm-simd-threaded.jsep.js',
    'vendor/ort-wasm-simd-threaded.jsep.wasm', 'models/dinov2/model.onnx'
  ]);
  const publicDir = path.join(root, 'firebase/staging-hosting/public');
  const walk = (folder, prefix = '') => readdirSync(folder).flatMap(name => {
    const relative = path.posix.join(prefix, name);
    const absolute = path.join(folder, name);
    return statSync(absolute).isDirectory() ? walk(absolute, relative) : [relative];
  });
  assert.deepEqual(new Set(walk(publicDir)), allowed);
  for (const page of ['scan.html', 'live.html']) {
    const generated = readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(generated, /JadeKey · ТЕСТ · без реальных камней/);
    assert.match(generated, /Архив изображений отключён в тестовом проекте/);
  }
});

test('staging administrator must hold a verified email token', () => {
  const rules = readFileSync(path.join(root, 'firebase/firestore.rules'), 'utf8');
  const isAdmin = rules.match(/function isAdmin\(\)\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(isAdmin);
  assert.match(isAdmin, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(isAdmin, /jadekey1965@gmail\.com/);
});

test('live activation of a registered catalog stone works in administrator session too', () => {
  const page = readFileSync(path.join(root, 'scan.html'), 'utf8');
  const start = page.indexOf('async function liveCapture(side)');
  const end = page.indexOf('function lvNav()', start);
  assert.ok(start > -1 && end > start);
  const wizard = page.slice(start, end);
  assert.match(wizard, /if \(side === 'A'\) \{/);
  assert.doesNotMatch(wizard, /if \(!isAdmin && side === 'A'\)/);
  assert.match(wizard, /LV\.src = cs/);
  assert.match(wizard, /LV\.srcBack = stones\.filter/);
  assert.match(wizard, /if \(cs\.mode \|\| cs\.of\)/);
  assert.match(page, /if \(LV\.src\) \{/);
});
