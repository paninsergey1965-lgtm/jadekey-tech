import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./scan.html', import.meta.url), 'utf8');
const accounts = readFileSync(new URL('./jk-accounts.js', import.meta.url), 'utf8');
const guide = html.match(/window\.JKVoiceDemo = \(\(\) => \{[\s\S]*?\n\}\)\(\);/)?.[0];

function voiceHarness({ lang = 'ru', search = '', muted = false, supported = true } = {}) {
  assert.ok(guide, 'voice guide must exist in scan.html');
  const controls = Object.fromEntries(['voiceDemoBtn', 'voiceWizardBtn', 'voicePreviewBtn', 'voiceEmailPreviewBtn'].map(id => [id, {
    style: { display: 'none' },
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }]));
  const spoken = [];
  let cancellations = 0;
  const listeners = {};
  const prefs = new Map([['jk2_voice_muted', muted ? '1' : '0']]);
  const synth = { cancel: () => { cancellations++; }, speak: utterance => spoken.push(utterance.text), getVoices: () => [{ lang: 'ru-RU' }] };
  function Utterance(text) { this.text = text; }
  const context = {
    window: {
      JK_LANG: lang,
      speechSynthesis: supported ? synth : undefined,
      SpeechSynthesisUtterance: supported ? Utterance : undefined,
      addEventListener: (name, handler) => { listeners[name] = handler; }
    },
    document: { getElementById: id => controls[id] },
    location: { search },
    localStorage: { getItem: key => prefs.get(key) ?? null, setItem: (key, value) => prefs.set(key, value) },
    URLSearchParams,
    SpeechSynthesisUtterance: Utterance
  };
  vm.runInNewContext(guide, context);
  listeners.DOMContentLoaded();
  return { voice: context.window.JKVoiceDemo, controls, spoken, prefs, get cancellations() { return cancellations; } };
}

test('registration steps speak in Russian without the test query flag', () => {
  const h = voiceHarness();
  assert.equal(h.controls.voiceDemoBtn.style.display, 'inline-block');
  assert.equal(h.controls.voiceWizardBtn.style.display, 'inline-block');
  assert.equal(h.controls.voicePreviewBtn.style.display, 'none');
  h.voice.step(0);
  assert.equal(h.spoken.length, 0, 'ordinary scanning must be silent');
  h.voice.begin();
  h.voice.step(0);
  assert.match(h.spoken.at(-1), /белый лист бумаги/i);
  h.voice.say('Я живой!');
  assert.equal(h.spoken.at(-1), 'Я живой!');
  h.voice.stop();
  assert.ok(h.cancellations > 0);
  h.voice.step(1);
  assert.equal(h.spoken.at(-1), 'Я живой!', 'voice must stop outside registration');
});

test('mute choice persists and blocks automatic registration speech', () => {
  const h = voiceHarness({ muted: true });
  h.voice.begin();
  h.voice.step(0);
  assert.equal(h.spoken.length, 0);
  assert.equal(h.controls.voiceDemoBtn.attributes['aria-pressed'], 'false');
  h.controls.voiceDemoBtn.onclick();
  assert.equal(h.prefs.get('jk2_voice_muted'), '0');
  assert.equal(h.controls.voiceDemoBtn.attributes['aria-pressed'], 'true');
  assert.equal(h.controls.voiceWizardBtn.attributes['aria-pressed'], 'true');
  assert.match(h.spoken.at(-1), /Голосовые подсказки включены/);
  h.voice.step(1);
  assert.match(h.spoken.at(-1), /вторую сторону/);
  h.controls.voiceWizardBtn.onclick();
  h.voice.step(2);
  assert.equal(h.controls.voiceDemoBtn.attributes['aria-pressed'], 'false');
  assert.match(h.spoken.at(-1), /вторую сторону/, 'wizard mute must silence remaining steps');
});

test('voice stays hidden for unsupported browsers and non-Russian UI', () => {
  for (const options of [{ lang: 'en' }, { lang: 'zh' }, { supported: false }]) {
    const h = voiceHarness(options);
    assert.equal(h.controls.voiceDemoBtn.style.display, 'none');
    h.voice.begin();
    h.voice.step(0);
    assert.equal(h.spoken.length, 0);
  }
});

test('preview buttons stay test-only', () => {
  const h = voiceHarness({ search: '?voice=1' });
  assert.equal(h.controls.voicePreviewBtn.style.display, 'inline-block');
  h.controls.voicePreviewBtn.onclick();
  assert.match(h.spoken.at(-1), /белый лист бумаги/);
  assert.equal(h.controls.voiceEmailPreviewBtn.style.display, 'inline-block');
  h.controls.voiceEmailPreviewBtn.onclick();
  assert.match(h.spoken.at(-1), /электронной почты/);
});

test('recognizing a living stone greets its owner only for a real scan', () => {
  const h = voiceHarness();
  h.voice.greet('stone-a', { name: 'Сергей' }, 'love');
  assert.match(h.spoken.at(-1), /Сергей/);
  assert.match(h.spoken.at(-1), /послание/);
  h.voice.greet('stone-a', { name: 'Сергей' }, 'love');
  assert.equal(h.spoken.length, 1, 'repeated scan events must not spam speech');
  h.voice.greet('stone-b', { name: 'Елена' }, 'mem');
  assert.match(h.spoken.at(-1), /воспоминание/);
  assert.equal(h.spoken.length, 2);
  h.controls.voiceDemoBtn.onclick();
  h.voice.greet('stone-c', { name: 'Ксюша' }, 'path');
  assert.equal(h.spoken.length, 2, 'mute setting must also silence daily greetings');
  const live = html.match(/async function showLive\(s, scanned\)[\s\S]*?\/\/ ---------- gift link:/)?.[0] || '';
  assert.match(live, /if \(scanned\) window\.JKVoiceDemo\?\.greet\(s\.id, P, s\.mode\)/);
  assert.match(html, /b\.onclick = \(\) => showLive\(s\);/);
});

test('voice hooks cover activation, email registration, and recognized daily stones', () => {
  assert.match(html, /\$\('lvStart'\)\.onclick[\s\S]{0,400}JKVoiceDemo\?\.begin\(\)/);
  assert.match(html, /JKVoiceDemo\?\.say\('Я живой!/);
  assert.match(accounts, /if \(mode === 'register'\) window\.JKVoiceDemo\?\.begin\(\)/);
  assert.match(accounts, /async function startLink\(\)[\s\S]{0,160}JKVoiceDemo\?\.begin\(\)/);
  assert.doesNotMatch(html.match(/\$\('shutter'\)\.onclick = async[\s\S]*?\/\/ ---------- collection view ----------/)?.[0] || '', /JKVoiceDemo/, 'unrecognized stones must not trigger a voice greeting');
  assert.doesNotMatch(guide, /SpeechRecognition|MediaRecorder|getUserMedia/);
});
