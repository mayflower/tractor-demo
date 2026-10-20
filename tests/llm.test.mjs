import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSchema, buildPrompt} from '../lib/llm.mjs';
import {parseServerTiming} from '../lib/tractor.mjs';

const request = {
  text: 'Atlas wiegt 3 kg.', many: true, anchor: 'name',
  fields: {name: {type: 'text', description: 'Name'}, weight: {type: 'quantity', description: 'Gewicht', unit: 'g'}, iban: {type: 'iban', description: 'IBAN'}},
};

test('strict schema lists every field and wraps records', () => {
  const schema = buildSchema(request);
  const item = schema.properties.records.items;
  assert.deepEqual(item.required, ['name', 'weight', 'iban']);
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.weight.type, ['number', 'null']);
  assert.deepEqual(item.properties.iban.type, ['string', 'null']);
});

test('prompt carries the typed contract but never an expected value', () => {
  const {user} = buildPrompt(request);
  assert.match(user, /Einheit g/);
  assert.match(user, /Prüfziffer/);
  assert.match(user, /Atlas wiegt 3 kg\./);
});

test('Server-Timing is parsed into stages', () => {
  assert.deepEqual(parseServerTiming('queue;dur=0.5, inference;dur=12.25'), {queue: 0.5, inference: 12.25});
  assert.deepEqual(parseServerTiming(null), {});
});
