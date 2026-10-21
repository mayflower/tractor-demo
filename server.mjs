import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {extname, join, normalize} from 'node:path';
import {once} from 'node:events';
import {readConfig, publicConfig, tractorConfigured, llmConfigured} from './lib/config.mjs';
import {publicScenarios} from './data/scenarios.mjs';
import {InputError, ProviderError} from './lib/errors.mjs';
import {selectRun, runExperiment} from './lib/runner.mjs';
import {scenarios} from './data/scenarios.mjs';
import {scoreCase} from './lib/score.mjs';
import {invokeTractor, tractorReady, warmupRequest} from './lib/tractor.mjs';
import {invokeLlm} from './lib/llm.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function json(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new InputError('Content-Type application/json erforderlich.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new InputError('Die Anfrage ist zu groß (maximal 64 KiB).', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('Ungültiges JSON.'); }
}

function requestAllowed(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // CLI and trusted reverse proxies.
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/** The playground forwards a typed request to tractor, which owns the full validation. */
function laneOf(body) {
  if (body.lane !== undefined && body.lane !== 'tractor' && body.lane !== 'llm') throw new InputError('Ungültige Seite.');
  return body.lane ?? 'tractor';
}

function playgroundRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Ungültige Anfrage.');
  if (body.caseId !== undefined) {
    // An unedited demo case is sent by id, so its reviewed expectation scores the answer.
    const kase = scenarios.flatMap(s => s.cases).find(c => c.id === body.caseId);
    if (!kase) throw new InputError('Unbekannter Demo-Fall.');
    return {request: {text: kase.text, ...kase.request}, lane: laneOf(body), kase};
  }
  const {text, fields, locale, anchor, many} = body.request ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new InputError('Der Text fehlt oder ist zu lang.');
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length || Object.keys(fields).length > 32 || !Object.keys(fields).every(k => FIELD_KEY.test(k))) {
    throw new InputError('fields muss 1 bis 32 benannte Felder enthalten.');
  }
  return {request: {text, fields, ...(locale ? {locale} : {}), ...(anchor ? {anchor} : {}), ...(many ? {many: true} : {})}, lane: laneOf(body)};
}

export function createApp(config = readConfig(), injected) {
  let active = false;
  const base = injected || {tractor: invokeTractor, llm: invokeLlm};
  // Rolling one-minute window over all comparison-LLM calls (health, playground, runs).
  const llmCalls = [];
  const providers = {
    tractor: base.tractor,
    llm: args => {
      const now = Date.now();
      while (llmCalls.length && now - llmCalls[0] > 60000) llmCalls.shift();
      if (llmCalls.length >= config.llm.maxPerMinute) return Promise.reject(new ProviderError('RATE_LIMIT', 'LLM-Limit pro Minute erreicht. Bitte kurz warten.', {status: 429}));
      llmCalls.push(now);
      return base.llm(args);
    },
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { return json(res, 400, {error: 'Ungültige URL.'}); }
    try {
      if (path.startsWith('/api/') && !requestAllowed(req)) return json(res, 403, {error: 'Die API ist nur aus derselben Webanwendung aufrufbar.'});
      if (req.method === 'GET' && path === '/api/config') return json(res, 200, publicConfig(config));
      if (req.method === 'GET' && path === '/api/scenarios') return json(res, 200, {scenarios: publicScenarios(), synthetic: true});
      if (req.method === 'GET' && path === '/api/health') {
        const health = {};
        if (!tractorConfigured(config.tractor)) health.tractor = {ok: false, configured: false, message: 'TRACTOR_URL konfigurieren.'};
        else {
          try {
            // /readyz proves the model is loaded; the extraction proves the whole pipeline answers.
            if (!await tractorReady({baseUrl: config.tractor.baseUrl})) throw new ProviderError('NOT_READY', 'tractor ist nicht bereit.');
            const answer = await providers.tractor({baseUrl: config.tractor.baseUrl, request: warmupRequest, timeoutMs: config.timeoutMs});
            health.tractor = {ok: answer.data.width === 125, configured: true, message: answer.data.width === 125 ? 'Pipeline antwortet.' : 'Unerwartete Antwort.', latencyMs: answer.timing.wallMs};
          } catch (error) {
            health.tractor = {ok: false, configured: true, message: error instanceof ProviderError ? error.message : 'Verbindungstest fehlgeschlagen.'};
          }
        }
        if (!llmConfigured(config.llm)) health.llm = {ok: false, configured: false, message: 'Optional: LLM_MODEL und LLM_API_KEY konfigurieren.'};
        else {
          try {
            const answer = await providers.llm({...config.llm, request: {text: 'Die Breite beträgt 12,5 cm.', fields: {width: {type: 'quantity', description: 'Breite', unit: 'mm'}}}, timeoutMs: config.timeoutMs});
            health.llm = {ok: true, configured: true, model: answer.model, message: 'Modell antwortet im erwarteten Format.', latencyMs: answer.timing.wallMs};
          } catch (error) {
            health.llm = {ok: false, configured: true, message: error instanceof ProviderError ? error.message : 'Verbindungstest fehlgeschlagen.'};
          }
        }
        return json(res, 200, health);
      }
      if (req.method === 'POST' && path === '/api/extract') {
        const {request, lane, kase} = playgroundRequest(await readJson(req));
        if (!tractorConfigured(config.tractor)) throw new InputError('TRACTOR_URL ist nicht konfiguriert.', 503);
        if (lane === 'llm' && !llmConfigured(config.llm)) throw new InputError('Vergleichs-LLM ist nicht konfiguriert.', 503);
        // One lane per call lets the browser race both systems and show each result as it arrives.
        const call = lane === 'llm'
          ? providers.llm({...config.llm, request, timeoutMs: config.timeoutMs})
          : providers.tractor({baseUrl: config.tractor.baseUrl, request, timeoutMs: config.timeoutMs});
        const answer = await call.then(value => ({ok: true, ...value}), error => ({ok: false, error: error instanceof ProviderError ? error.message : 'Unerwarteter Fehler.', code: error instanceof ProviderError ? error.code : 'INTERNAL'}));
        const scored = kase && answer.ok ? {...answer, score: scoreCase(kase, answer.data, lane === 'tractor' ? answer.issues : null)} : answer;
        return json(res, 200, {lane, result: scored});
      }
      if (req.method === 'POST' && path === '/api/run') {
        const selection = selectRun(await readJson(req), config);
        // A single run keeps latency measurements comparable; re-check after the body was read.
        if (active) return json(res, 409, {error: 'Es läuft bereits eine Messung. Bitte zuerst beenden.'});
        active = true;
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        res.writeHead(200, {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no'});
        const emit = event => { if (!controller.signal.aborted) res.write(`${JSON.stringify(event)}\n`); };
        try {
          await runExperiment({selection, config, providers, emit, signal: controller.signal});
        } catch (error) {
          if (!controller.signal.aborted) emit({type: 'error', message: error instanceof ProviderError ? error.message : 'Lauf abgebrochen.'});
        } finally { active = false; res.end(); }
        return;
      }
      if (req.method === 'GET' && !path.startsWith('/api/')) {
        const relative = path === '/' ? 'index.html' : normalize(path).replace(/^([/\\])+/, '');
        const file = join(publicDir, relative);
        if (!file.startsWith(publicDir)) return json(res, 404, {error: 'Nicht gefunden.'});
        try {
          const body = await readFile(file);
          res.writeHead(200, {'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'});
          return res.end(body);
        } catch { return json(res, 404, {error: 'Nicht gefunden.'}); }
      }
      return json(res, 404, {error: 'Nicht gefunden.'});
    } catch (error) {
      if (error instanceof InputError) return json(res, error.status, {error: error.message});
      console.error('Unhandled request error:', error?.message);
      return json(res, 500, {error: 'Interner Fehler.'});
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config;
  try { config = readConfig(); } catch (error) { console.error(error.message); process.exit(1); }
  const server = createApp(config);
  server.listen(config.port, config.host);
  await once(server, 'listening');
  console.log(`tractor demo on http://${config.host}:${server.address().port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
