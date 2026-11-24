import test, { before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const ADMIN = 'IMrM4KZVGddIWBEXkJR1dj6YHxh2';
const projectId = 'demo-jadekey-test'; // demo- prefix blocks real Firebase access.
let env;

const live = (owner = 'buyer-1') => ({
  name: 'Живой камень', mode: 'path', owner, of: '', created: 1,
  thumb: 'image', g: 'fingerprint', G: 32, hue: 40, n: 493
});
const privateStone = (owner = 'buyer-1') => ({
  owner, recipient: '', claim: 'random-claim-value', claimTry: '', share: false,
  profile: '{"name":"Тест"}', created: 1
});
const client = (uid = 'buyer-1', email = 'buyer@example.com') => ({
  owner: uid, email, verified: true, updated: 1
});
const ctx = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const guest = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: {
    rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')
  } });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'jk2_stones', 'catalog-1'), { ...live(''), name: 'Тестовый каталог', mode: '', jk: 'JK-000001' });
    await setDoc(doc(db, 'jk2_patches', 'catalog-1'), { idx: 'a', p: 'b', sc: 'c' });
    await setDoc(doc(db, 'jk2_stones', 'live-1'), live());
    await setDoc(doc(db, 'jk2_private', 'live-1'), privateStone());
    await setDoc(doc(db, 'jk2_clients', 'buyer-1'), client());
  });
});

after(async () => { if (env) await env.cleanup(); });

test('scanner can read test catalog and patches without signing in', async () => {
  const db = guest();
  await assertSucceeds(getDocs(collection(db, 'jk2_stones')));
  await assertSucceeds(getDoc(doc(db, 'jk2_patches', 'catalog-1')));
  await assertFails(getDoc(doc(db, 'jk2_private', 'live-1')));
  await assertFails(getDocs(collection(db, 'jk2_private')));
  await assertFails(getDocs(collection(db, 'jk2_clients')));
  await assertFails(getDoc(doc(db, 'jk2_clients', 'buyer-1')));
  await assertFails(getDocs(collection(db, 'jk2_adminlog')));
  await assertFails(setDoc(doc(db, 'jk2_stones', 'fake'), live('guest')));
  await assertFails(getDocs(collection(db, 'unrelated')));
});

test('buyer may activate a stone, but may not impersonate another owner or edit mode', async () => {
  const db = ctx('buyer-1');
  await assertSucceeds(setDoc(doc(db, 'jk2_stones', 'new-live'), live()));
  await assertSucceeds(setDoc(doc(db, 'jk2_patches', 'new-live'), { idx: 'a', p: 'b', sc: 'c' }));
  await assertSucceeds(setDoc(doc(db, 'jk2_private', 'new-live'), privateStone()));
  await assertFails(setDoc(doc(db, 'jk2_stones', 'wrong-owner'), live('somebody-else')));
  await assertFails(setDoc(doc(db, 'jk2_stones', 'fake-catalog'), { ...live(), mode: '', jk: 'JK-002' }));
  await assertFails(updateDoc(doc(db, 'jk2_stones', 'live-1'), { mode: 'love' }));
  await assertFails(deleteDoc(doc(db, 'jk2_stones', 'catalog-1')));
  await assertSucceeds(deleteDoc(doc(db, 'jk2_stones', 'new-live')));
});

test('customer details stay private; a single gift recipient can claim a stone', async () => {
  const owner = ctx('buyer-1');
  const recipient = ctx('recipient-1');
  const stranger = ctx('stranger-1');
  await assertSucceeds(getDoc(doc(owner, 'jk2_private', 'live-1')));
  await assertFails(getDoc(doc(stranger, 'jk2_private', 'live-1')));
  await assertFails(updateDoc(doc(stranger, 'jk2_private', 'live-1'), { share: true }));
  await assertSucceeds(updateDoc(doc(recipient, 'jk2_private', 'live-1'), {
    recipient: 'recipient-1', claimTry: 'random-claim-value'
  }));
  await assertSucceeds(getDoc(doc(recipient, 'jk2_private', 'live-1')));
  await assertFails(updateDoc(doc(stranger, 'jk2_private', 'live-1'), {
    recipient: 'stranger-1', claimTry: 'random-claim-value'
  }));
  await assertSucceeds(updateDoc(doc(owner, 'jk2_private', 'live-1'), { share: true }));
  await assertSucceeds(getDoc(doc(guest(), 'jk2_private', 'live-1')));
});

test('verified buyer can index only their own verified email', async () => {
  const verified = ctx('buyer-1', { email: 'buyer@example.com', email_verified: true });
  const unverified = ctx('new-buyer', { email: 'new@example.com', email_verified: false });
  await assertSucceeds(getDoc(doc(verified, 'jk2_clients', 'buyer-1')));
  await assertFails(getDocs(collection(verified, 'jk2_clients')));
  await assertSucceeds(setDoc(doc(verified, 'jk2_clients', 'buyer-1'), client()));
  await assertFails(setDoc(doc(verified, 'jk2_clients', 'other'), client('other')));
  await assertFails(setDoc(doc(verified, 'jk2_clients', 'buyer-1'), client('buyer-1', 'other@example.com')));
  await assertFails(setDoc(doc(unverified, 'jk2_clients', 'new-buyer'), client('new-buyer', 'new@example.com')));
});

test('only test administrator can list clients, transfer stones and append audit', async () => {
  const admin = ctx(ADMIN, { email: 'jadekey1965@gmail.com', email_verified: true });
  const buyer = ctx('buyer-1');
  const records = await assertSucceeds(getDocs(collection(admin, 'jk2_clients')));
  assert.equal(records.size, 1);
  await assertSucceeds(updateDoc(doc(admin, 'jk2_stones', 'live-1'), { owner: 'recipient-1' }));
  await assertSucceeds(updateDoc(doc(admin, 'jk2_private', 'live-1'), { owner: 'recipient-1' }));
  await assertSucceeds(setDoc(doc(admin, 'jk2_adminlog', 'log-1'), { action: 'transfer' }));
  await assertFails(updateDoc(doc(admin, 'jk2_adminlog', 'log-1'), { action: 'tamper' }));
  await assertFails(deleteDoc(doc(buyer, 'jk2_private', 'live-1')));
  await assertFails(getDocs(collection(buyer, 'jk2_adminlog')));
});
