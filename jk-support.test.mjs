import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySupportQuestion } from './jk-support.js';

test('FAQ understands the main buyer questions', () => {
  assert.equal(classifySupportQuestion('Как оживить мой L8?'), 'activate');
  assert.equal(classifySupportQuestion('Камера не узнаёт камень'), 'light');
  assert.equal(classifySupportQuestion('Я потерял пароль'), 'account');
  assert.equal(classifySupportQuestion('Какая цена и доставка?'), 'sale');
  assert.equal(classifySupportQuestion('How do I activate it?'), 'activate');
  assert.equal(classifySupportQuestion('扫描反光怎么办?'), 'light');
});

test('handoff must be explicit for requests outside the FAQ', () => {
  assert.equal(classifySupportQuestion('Позовите оператора'), 'handoff');
  assert.equal(classifySupportQuestion('I want to talk to a human'), 'handoff');
  assert.equal(classifySupportQuestion('У меня редкая проблема с камнем'), 'unknown');
});
