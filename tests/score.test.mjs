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

test('hospital bed accepts rounded conversions for both systems but still requires rejection of the weight limit', () => {
  const kase = scenarios.flatMap(s => s.cases).find(k => k.id === 'unit-44');
  const data = {work_height: 31.4961, bed_length: 6.88976, mattress: 120, capacity: null, lowering: 0.072};
  assert.ok(scoreCase(kase, data, null).exact);
  assert.ok(scoreCase(kase, data, kase.expected.issues).exact);

  const screenshot = scoreCase(kase, {...data, capacity: 440.925}, null);
  assert.deepEqual(screenshot.fields.filter(f => !f.ok).map(f => f.field), ['capacity']);
  assert.ok(!screenshot.exact);
});

test('quantity tolerance accepts useful rounding and rejects incorrect values across scales', () => {
  const kase = value => ({request: {fields: {q: {type: 'quantity'}}}, expected: {data: {q: value}, issues: []}});
  for (const [actual, expected] of [[31.496, 31.496062992125985], [6.89, 6.889763779527559], [10.0009, 10], [-40.001, -40], [1.00005e-12, 1e-12], [0, 0]]) {
    assert.ok(scoreCase(kase(expected), {q: actual}, null).exact, `${actual} ≈ ${expected}`);
  }
  for (const [actual, expected] of [[31.5, 31.496062992125985], [6.88, 6.889763779527559], [10.0011, 10], [80, 31.496062992125985], [0, 1e-12], [1e-12, 0], [-1, 1], ['6.89', 6.889763779527559], [NaN, 1], [Infinity, 1]]) {
    assert.ok(!scoreCase(kase(expected), {q: actual}, null).exact, `${actual} ≠ ${expected}`);
  }
});

test('rounding tolerance does not relax money or other numeric fields', () => {
  for (const type of ['money', 'number', 'percent']) {
    const kase = {request: {fields: {n: {type}}}, expected: {data: {n: 12345.67}, issues: []}};
    assert.ok(!scoreCase(kase, {n: 12345.68}, null).dataOk, type);
    assert.ok(scoreCase(kase, {n: 12345.67}, null).dataOk, type);
  }
});

test('quantity rounding applies to records, candidate arrays and accepted alternatives', () => {
  const kase = {
    request: {many: true, fields: {q: {type: 'quantity'}}},
    expected: {data: [{q: [31.496062992125985, 6.889763779527559]}, {q: 31.496062992125985}], issues: []},
    accept: {q: [6.889763779527559]},
  };
  assert.ok(scoreCase(kase, [{q: [31.4961, 6.88976]}, {q: 6.88976}], null).exact);
  assert.ok(!scoreCase(kase, [{q: [31.51, 6.88976]}, {q: 6.88976}], null).dataOk);
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
    assert.ok(kase.text.length < 1250, kase.id); // joint 512-token window with the schema
  }
});

test('demo scenarios exclude the edge cases, and every candidate sits in exactly one scenario', async () => {
  const {demoCases, scenarioIndex} = await import('../data/scenarios.mjs');
  assert.ok(demoCases().length >= 60);
  assert.ok(!demoCases().some(c => scenarioIndex.get('edge').cases.includes(c)));
  assert.ok(scenarioIndex.get('edge').cases.every(c => c.from));
});
