import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firebase/staging-firestore/firestore.rules', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../firebase/staging-firestore/firebase.json', import.meta.url), 'utf8'));

test('staging has its own Firestore rules file with no production deployment config', () => {
  assert.deepEqual(config, { firestore: { rules: 'firestore.rules' } });
  assert.match(rules, /STAGING ONLY: jadekey-test/);
  assert.match(rules, /request\.auth\.uid == 'IMrM4KZVGddIWBEXkJR1dj6YHxh2'/);
  assert.doesNotMatch(JSON.stringify(config), /jadekey-46f37/);
});

test('public can scan test fingerprints but only verified owners index their emails', () => {
  assert.match(rules, /match \/jk2_stones\/\{id\} \{\s*[\s\S]*?allow get, list: if true/);
  assert.match(rules, /match \/jk2_patches\/\{id\} \{\s*[\s\S]*?allow get, list: if true/);
  assert.match(rules, /match \/jk2_clients\/\{uid\} \{[\s\S]*?allow list: if isAdmin\(\)/);
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false/);
});
