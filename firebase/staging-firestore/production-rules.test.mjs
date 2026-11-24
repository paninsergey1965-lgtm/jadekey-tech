import test, { before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const ADMIN = 'Tr0dEgYZr0RljJP81rY8ELsTTUq2';
let env;
const ctx = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const guest = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-jadekey-production-rules',
    firestore: { rules: readFileSync(new URL('../production-firestore/firestore.rules', import.meta.url), 'utf8') }
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'jk2_stones', 'catalog'), { name: 'catalog', owner: '', mode: '' });
    await setDoc(doc(db, 'jk2_patches', 'catalog'), { image: 'existing' });
    await setDoc(doc(db, 'jk2_stones', 'live'), { name: 'live', owner: 'buyer', mode: 'love' });
    await setDoc(doc(db, 'jk2_private', 'live'), { owner: 'buyer', share: false, recipient: '', claim: 'secret' });
  });
});
after(async () => { if (env) await env.cleanup(); });

test('production public scanner keeps access to its existing catalog and patches', async () => {
  await assertSucceeds(getDocs(collection(guest(), 'jk2_stones')));
  await assertSucceeds(getDocs(collection(guest(), 'jk2_patches')));
  await assertFails(getDoc(doc(guest(), 'jk2_private', 'live')));
  await assertFails(getDocs(collection(guest(), 'jk2_clients')));
  await assertFails(getDocs(collection(guest(), 'jk2_adminlog')));
});

test('existing anonymous activation/ownership and legacy collection behavior remain usable', async () => {
  const buyer = ctx('buyer');
  const stranger = ctx('stranger');
  await assertSucceeds(setDoc(doc(buyer, 'jk2_stones', 'new'), { owner: 'buyer', mode: 'love' }));
  await assertSucceeds(setDoc(doc(buyer, 'jk2_patches', 'new'), { patch: 1 }));
  await assertSucceeds(setDoc(doc(buyer, 'jk2_private', 'new'), { owner: 'buyer', share: false }));
  await assertSucceeds(updateDoc(doc(buyer, 'jk2_stones', 'new'), { name: 'rename' }));
  await assertFails(updateDoc(doc(stranger, 'jk2_stones', 'new'), { name: 'steal' }));
  await assertSucceeds(setDoc(doc(guest(), 'legacy_shop', 'legacy-record'), { allowed: true }));
  await assertSucceeds(getDoc(doc(guest(), 'legacy_shop', 'legacy-record')));
});

test('verified client index is private, cannot be spoofed, and cannot be publicly written', async () => {
  const buyer = ctx('buyer', { email: 'buyer@example.com', email_verified: true });
  const unverified = ctx('other', { email: 'other@example.com', email_verified: false });
  const client = { owner: 'buyer', email: 'buyer@example.com', verified: true, updated: 100 };
  await assertSucceeds(setDoc(doc(buyer, 'jk2_clients', 'buyer'), client));
  await assertSucceeds(getDoc(doc(buyer, 'jk2_clients', 'buyer')));
  await assertFails(getDocs(collection(buyer, 'jk2_clients')));
  await assertFails(getDoc(doc(guest(), 'jk2_clients', 'buyer')));
  await assertFails(setDoc(doc(guest(), 'jk2_clients', 'ghost'), client));
  await assertFails(setDoc(doc(unverified, 'jk2_clients', 'other'), { ...client, owner: 'other', email: 'other@example.com' }));
  await assertFails(setDoc(doc(buyer, 'jk2_clients', 'other'), client));
  await assertFails(updateDoc(doc(buyer, 'jk2_clients', 'buyer'), { owner: 'other' }));
});

test('only the exact owner UID and email gets administrator access and append-only audit', async () => {
  const admin = ctx(ADMIN, { email: 'jadekey1965@gmail.com', email_verified: true });
  const sameEmail = ctx('impostor', { email: 'jadekey1965@gmail.com', email_verified: true });
  const wrongEmail = ctx(ADMIN, { email: 'other@example.com', email_verified: true });
  await assertFails(getDocs(collection(sameEmail, 'jk2_clients')));
  await assertFails(getDocs(collection(wrongEmail, 'jk2_clients')));
  await assertSucceeds(getDocs(collection(admin, 'jk2_clients')));
  const batch = writeBatch(admin);
  batch.delete(doc(admin, 'jk2_stones', 'live'));
  batch.delete(doc(admin, 'jk2_private', 'live'));
  batch.set(doc(admin, 'jk2_adminlog', 'log-1'), { action: 'reset' });
  await assertSucceeds(batch.commit());
  assert.equal((await getDoc(doc(admin, 'jk2_stones', 'catalog'))).exists(), true);
  await assertFails(getDoc(doc(guest(), 'jk2_adminlog', 'log-1')));
  await assertFails(updateDoc(doc(admin, 'jk2_adminlog', 'log-1'), { action: 'tamper' }));
  await assertFails(deleteDoc(doc(admin, 'jk2_adminlog', 'log-1')));
});

test('historically public shared private records retain their former read behavior', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'jk2_private', 'live'), { share: true });
  });
  await assertSucceeds(getDoc(doc(guest(), 'jk2_private', 'live')));
});

test('support conversations are readable only by their customer and the exact admin', async () => {
  const buyer = ctx('buyer');
  const stranger = ctx('stranger');
  const admin = ctx(ADMIN, { email: 'jadekey1965@gmail.com', email_verified: true });
  const impostor = ctx('other-admin', { email: 'jadekey1965@gmail.com', email_verified: true });
  const conversation = doc(buyer, 'jk2_support', 'buyer');
  await assertSucceeds(setDoc(conversation, {
    ownerUid: 'buyer', status: 'waiting', lastMessage: 'Help', updated: 123
  }));
  await assertSucceeds(setDoc(doc(buyer, 'jk2_support', 'buyer', 'messages', 'm1'), {
    author: 'client', body: 'Help me activate L8', created: 123
  }));
  await assertSucceeds(getDoc(conversation));
  await assertSucceeds(getDocs(collection(buyer, 'jk2_support', 'buyer', 'messages')));
  await assertSucceeds(getDocs(collection(admin, 'jk2_support')));
  await assertSucceeds(getDocs(collection(admin, 'jk2_support', 'buyer', 'messages')));
  await assertFails(getDoc(doc(guest(), 'jk2_support', 'buyer')));
  await assertFails(getDoc(doc(stranger, 'jk2_support', 'buyer')));
  await assertFails(getDocs(collection(stranger, 'jk2_support')));
  await assertFails(getDocs(collection(impostor, 'jk2_support')));
  await assertFails(getDocs(collection(guest(), 'jk2_support', 'buyer', 'messages')));
  await assertFails(getDocs(collection(stranger, 'jk2_support', 'buyer', 'messages')));
});

test('support author and conversation owner cannot be spoofed', async () => {
  const buyer = ctx('buyer');
  const stranger = ctx('stranger');
  const admin = ctx(ADMIN, { email: 'jadekey1965@gmail.com', email_verified: true });
  await assertFails(setDoc(doc(stranger, 'jk2_support', 'buyer'), {
    ownerUid: 'buyer', status: 'waiting', lastMessage: 'fake', updated: 100
  }));
  await assertFails(setDoc(doc(buyer, 'jk2_support', 'buyer', 'messages', 'faked-admin'), {
    author: 'admin', body: 'Pretending to be support', created: 123
  }));
  await assertFails(setDoc(doc(buyer, 'jk2_support', 'buyer', 'messages', 'too-long'), {
    author: 'client', body: 'x'.repeat(1001), created: 123
  }));
  await assertSucceeds(setDoc(doc(admin, 'jk2_support', 'buyer', 'messages', 'real-admin'), {
    author: 'admin', body: 'How can I help?', created: 124
  }));
  await assertFails(deleteDoc(doc(buyer, 'jk2_support', 'buyer', 'messages', 'real-admin')));
});
