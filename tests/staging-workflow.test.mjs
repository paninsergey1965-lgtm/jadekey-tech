import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/deploy-jadekey-test.yml', import.meta.url), 'utf8');

test('GitHub action can run only on an explicit test-only release tag', () => {
  assert.match(workflow, /tags:\s*\n\s*- deploy-jadekey-test-\*/);
  assert.match(workflow, /startsWith\(github.ref, 'refs\/tags\/deploy-jadekey-test-'\)/);
  assert.doesNotMatch(workflow, /pull_request:|branches:|workflow_dispatch:/);
});

test('GitHub action deploys only test Hosting and independently tested staging Firestore rules', () => {
  assert.match(workflow, /projectId: jadekey-test/);
  assert.match(workflow, /entryPoint: \.\/firebase\/staging-hosting/);
  assert.match(workflow, /channelId: live/);
  assert.match(workflow, /secrets\.FIREBASE_SERVICE_ACCOUNT_JADEKEY_TEST/);
  assert.match(workflow, /npm test --prefix firebase\/staging-firestore/);
  assert.match(workflow, /firebase deploy --only firestore:rules --project jadekey-test --config firebase\/staging-firestore\/firebase\.json/);
  assert.doesNotMatch(workflow, /jadekey-46f37|cloudflare|wrangler|functions:/i);
});
