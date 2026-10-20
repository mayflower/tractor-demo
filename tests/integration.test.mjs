import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {readConfig} from '../lib/config.mjs';
import {scenarioIndex} from '../data/scenarios.mjs';

// A stand-in for tractor that answers the reviewed expectation, so the run protocol is testable offline.
function fakeTractor() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/readyz') return res.end('{"status":"ready"}');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const kase = [...scenarioIndex.values()].flatMap(s => s.cases).find(c => c.text === body.text);
    const answer = kase ? {data: kase.expected.data, issues: kase.expected.issues} : {data: {width: 125}, issues: []};
    res.writeHead(200, {'content-type': 'application/json', 'server-timing': 'inference;dur=3.5', 'x-tractor-input-tokens': '42'});
    res.end(JSON.stringify(answer));
  });
  return server;
}

async function start(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }

test('run streams scored results and a summary, and health reports readiness', async () => {
  const tractor = fakeTractor();
  const tractorUrl = await start(tractor);
  const app = createApp(readConfig({TRACTOR_URL: tractorUrl, TRACTOR_COST_PER_HOUR: '3.6'}));
  const base = await start(app);
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.tractor.ok, true);
    assert.equal(health.llm.configured, false);

    const response = await fetch(`${base}/api/run`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({scenario: 'units', mode: 'tractor', warmup: false})});
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].type, 'start');
    const results = events.filter(e => e.type === 'result');
    assert.equal(results.length, scenarioIndex.get('units').cases.length);
    assert.ok(results.every(r => r.score.exact && r.timing.stages.inference === 3.5));
    const done = events.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.summaries[0].exact, results.length);
    assert.ok(done.summaries[0].cost > 0);
  } finally { app.close(); tractor.close(); }
});

test('compare without a configured LLM is refused, unknown scenarios are rejected', async () => {
  const app = createApp(readConfig({TRACTOR_URL: 'http://127.0.0.1:9'}));
  const base = await start(app);
  try {
    const post = body => fetch(`${base}/api/run`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal((await post({scenario: 'units', mode: 'compare'})).status, 503);
    assert.equal((await post({scenario: 'nope'})).status, 400);
    const cross = await fetch(`${base}/api/config`, {headers: {'sec-fetch-site': 'cross-site'}});
    assert.equal(cross.status, 403);
  } finally { app.close(); }
});

test('a down tractor yields per-case errors that count as wrong answers', async () => {
  const app = createApp(readConfig({TRACTOR_URL: 'http://127.0.0.1:9', REQUEST_TIMEOUT_MS: '500'}));
  const base = await start(app);
  try {
    const response = await fetch(`${base}/api/run`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({scenario: 'rejection', mode: 'tractor', warmup: false})});
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    const done = events.at(-1);
    assert.equal(done.summaries[0].errors, scenarioIndex.get('rejection').cases.length);
    assert.equal(done.summaries[0].rejectionOk, 0);
  } finally { app.close(); }
});

test('playground validates the request and forwards it', async () => {
  const tractor = fakeTractor();
  const app = createApp(readConfig({TRACTOR_URL: await start(tractor)}));
  const base = await start(app);
  try {
    const post = body => fetch(`${base}/api/extract`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal((await post({request: {text: '', fields: {a: {type: 'text', description: 'x'}}}})).status, 400);
    assert.equal((await post({request: {text: 'x', fields: {'bad key': {}}}})).status, 400);
    const ok = await (await post({request: {text: 'Breite: 12,5 cm.', fields: {width: {type: 'quantity', description: 'Breite', unit: 'mm'}}}})).json();
    assert.equal(ok.result.ok, true);
  } finally { app.close(); tractor.close(); }
});

test('compare mode scores a strict-schema LLM answer on data only and prices its tokens', async () => {
  const tractor = fakeTractor();
  const seen = [];
  const llm = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    seen.push({auth: req.headers.authorization, strict: body.response_format.json_schema.strict});
    const props = body.response_format.json_schema.schema.properties;
    const many = 'records' in props;
    const empty = Object.fromEntries(Object.keys(many ? props.records.items.properties : props).map(k => [k, null]));
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({model: 'fake', choices: [{finish_reason: 'stop', message: {content: JSON.stringify(many ? {records: []} : empty)}}], usage: {prompt_tokens: 100, completion_tokens: 10}}));
  });
  const config = readConfig({TRACTOR_URL: await start(tractor), LLM_BASE_URL: await start(llm), LLM_MODEL: 'fake', LLM_API_KEY: 'k', LLM_PRICE_INPUT_PER_MTOK: '1', LLM_PRICE_OUTPUT_PER_MTOK: '2'});
  const app = createApp(config);
  const base = await start(app);
  try {
    const response = await fetch(`${base}/api/run`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({scenario: 'rejection', mode: 'compare', warmup: false})});
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    const [tractorSummary, llmSummary] = events.at(-1).summaries;
    const n = scenarioIndex.get('rejection').cases.length;
    assert.equal(tractorSummary.exact, n);
    assert.equal(llmSummary.rejectionOk, n); // all-null answers reject everything
    assert.equal(llmSummary.issuesOk, 0);
    assert.equal(llmSummary.inputTokens, n * 100);
    assert.ok(Math.abs(llmSummary.cost - n * (100 * 1 + 10 * 2) / 1e6) < 1e-12);
    assert.ok(seen.every(s => s.auth === 'Bearer k' && s.strict === true));
  } finally { app.close(); tractor.close(); llm.close(); }
});

test('the LLM lane is capped per minute while tractor stays unlimited', async () => {
  const tractor = fakeTractor();
  let llmCalls = 0;
  const providers = {
    tractor: async ({request}) => ({data: {width: 125}, issues: [], timing: {wallMs: 1, stages: {}}, usage: {}}),
    llm: async () => { llmCalls += 1; return {data: {width: 125}, issues: null, timing: {wallMs: 1, stages: {}}, usage: {}, model: 'fake'}; },
  };
  const app = createApp(readConfig({TRACTOR_URL: await start(tractor), LLM_MODEL: 'fake', LLM_API_KEY: 'k', LLM_MAX_PER_MINUTE: '2'}), providers);
  const base = await start(app);
  try {
    const body = lane => JSON.stringify({request: {text: 'Breite: 12,5 cm.', fields: {width: {type: 'quantity', description: 'Breite', unit: 'mm'}}}, lane});
    const call = lane => fetch(`${base}/api/extract`, {method: 'POST', headers: {'content-type': 'application/json'}, body: body(lane)}).then(r => r.json());
    assert.equal((await call('llm')).result.ok, true);
    assert.equal((await call('llm')).result.ok, true);
    const limited = (await call('llm')).result;
    assert.equal(limited.ok, false);
    assert.equal(limited.code, 'RATE_LIMIT');
    assert.equal(llmCalls, 2);
    for (let i = 0; i < 5; i += 1) assert.equal((await call('tractor')).result.ok, true);
  } finally { app.close(); tractor.close(); }
});
