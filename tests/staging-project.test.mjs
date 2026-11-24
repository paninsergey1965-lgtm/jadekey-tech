import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const file of ['scan.html', 'live.html']) {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  test(`${file} sends admin credentials when listing Firestore`, () => {
    const listing = html.match(/async function fsList\([\s\S]+?\n}\n/);
    assert.ok(listing, `Firestore listing exists in ${file}`);
    assert.match(listing[0], /headers:\s*await authHeaders\(\)/);
  });
  const declaration = html.match(/const FS = [\s\S]+?;\nconst BASE =/);
  assert.ok(declaration, `Firebase project selection is present in ${file}`);

  for (const [hostname, expected] of [
    ['jadekey-test.web.app', 'jadekey-test'],
    ['jadekey-test.firebaseapp.com', 'jadekey-test'],
    ['jadekey.tech', 'jadekey-46f37'],
    ['www.jadekey.tech', 'jadekey-46f37']
  ]) {
    test(`${file} on ${hostname} uses ${expected}`, () => {
      const context = { location: { hostname } };
      const expression = declaration[0].replace(/;\nconst BASE =$/, ';\nglobalThis.projectId = FS.project;');
      vm.runInNewContext(expression, context);
      assert.equal(context.projectId, expected);
    });
  }
}
