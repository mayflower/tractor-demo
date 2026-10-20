import test from 'node:test';
import assert from 'node:assert/strict';
import {sameValue, scoreCase, summarize, failedScore} from '../lib/score.mjs';
import {scenarios} from '../data/scenarios.mjs';

test('numbers compare by value, strings exactly', () => {
  assert.ok(sameValue(12.50, 12.5));
  assert.ok(sameValue(403.8912749542671000001, 403.8912749542671));
  assert.ok(!sameValue('12.5', 12.5));
  assert.ok(sameValue(null, null) && !sameValue(null, 0));
});

test('accepted alternatives count, unlisted variants do not', () => {
  const kase = {expected: {data: {p: 'Dr. Anna Weber'}, issues: []}, accept: {p: ['Anna Weber']}};
  assert.ok(scoreCase(kase, {p: 'Anna Weber'}, []).dataOk);
  assert.ok(!scoreCase(kase, {p: 'Weber'}, []).dataOk);
});

test('a correct rejection needs null and the expected issue code', () => {
  const kase = {expected: {data: {iban: null}, issues: [{field: 'iban', code: 'invalid_iban'}]}};
  assert.ok(scoreCase(kase, {iban: null}, [{field: 'iban', code: 'invalid_iban'}]).exact);
  const wrongCode = scoreCase(kase, {iban: null}, [{field: 'iban', code: 'not_found'}]);
  assert.ok(wrongCode.dataOk && !wrongCode.exact);
  assert.ok(!scoreCase(kase, {iban: 'DE89370400440532013001'}, []).dataOk);
});

test('LLM answers have no issues and are scored on data only', () => {
  const kase = {expected: {data: {iban: null}, issues: [{field: 'iban', code: 'invalid_iban'}]}};
  assert.equal(scoreCase(kase, {iban: null}, null).issuesOk, null);
  assert.ok(scoreCase(kase, {iban: null}, null).exact);
});

test('records compare by position and extra records fail', () => {
  const kase = {expected: {data: [{n: 'A', w: 1}, {n: 'B', w: 2}], issues: []}};
  assert.ok(scoreCase(kase, [{n: 'A', w: 1}, {n: 'B', w: 2}], []).exact);
  assert.ok(!scoreCase(kase, [{n: 'A', w: 1}], []).dataOk);
  assert.ok(!scoreCase(kase, [{n: 'A', w: 1}, {n: 'B', w: 2}, {n: 'C', w: 3}], []).dataOk);
});

test('summary separates positive extraction from rejection and counts errors as wrong', () => {
  const kase = {expected: {data: {a: 1, b: null}, issues: []}};
  const ok = {score: scoreCase(kase, {a: 1, b: null}, [])};
  const failed = {error: 'x', score: failedScore(kase, true)};
  const total = summarize([ok, failed]);
  assert.deepEqual([total.positive, total.positiveOk, total.rejection, total.rejectionOk, total.errors], [2, 1, 2, 1, 1]);
});

test('every scenario case is well-formed and its text fits the document limit', () => {
  const ids = new Set();
  for (const scenario of scenarios) for (const kase of scenario.cases) {
    assert.ok(!ids.has(kase.id), `duplicate id ${kase.id}`);
    ids.add(kase.id);
    const expectedRecords = Array.isArray(kase.expected.data) ? kase.expected.data : [kase.expected.data];
    for (const record of expectedRecords) assert.deepEqual(Object.keys(record).sort(), Object.keys(kase.request.fields).sort(), kase.id);
    assert.equal(Array.isArray(kase.expected.data), Boolean(kase.request.many), kase.id);
    if (kase.request.many) assert.ok(kase.request.fields[kase.request.anchor], kase.id);
    assert.ok(kase.text.length < 600, kase.id);
  }
});
