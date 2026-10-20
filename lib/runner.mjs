import {scenarioIndex} from '../data/scenarios.mjs';
import {tractorConfigured, llmConfigured} from './config.mjs';
import {InputError, ProviderError} from './errors.mjs';
import {scoreCase, failedScore, summarize} from './score.mjs';
import {warmupRequest} from './tractor.mjs';

const MODES = new Set(['tractor', 'compare']);
const SCHEDULES = new Set(['parallel', 'sequential']);

export function selectRun(body, config) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Ungültige Anfrage.');
  // 'all' is the speed run over every demo case.
  const scenario = body.scenario === 'all'
    ? {id: 'all', cases: [...scenarioIndex.values()].flatMap(s => s.cases)}
    : scenarioIndex.get(body.scenario);
  if (!scenario) throw new InputError('Unbekannte Demo.');
  const mode = body.mode ?? 'compare';
  const schedule = body.schedule ?? 'parallel';
  if (!MODES.has(mode) || !SCHEDULES.has(schedule)) throw new InputError('Ungültiger Modus.');
  if (!tractorConfigured(config.tractor)) throw new InputError('TRACTOR_URL ist nicht konfiguriert. Die Datenvorschau bleibt verfügbar.', 503);
  if (mode === 'compare' && !llmConfigured(config.llm)) throw new InputError('Vergleichs-LLM ist nicht konfiguriert (LLM_MODEL und LLM_API_KEY).', 503);
  return {scenario, mode, schedule, warmup: body.warmup !== false};
}

function costOf(lane, config, wallMs, usage) {
  if (lane === 'tractor') return config.tractor.costPerHour === null ? null : (wallMs / 3_600_000) * config.tractor.costPerHour;
  const pricing = config.llm.pricing;
  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) return null;
  return (usage.inputTokens * pricing.inputPerMTok + usage.outputTokens * pricing.outputPerMTok) / 1_000_000;
}

async function runLane({lane, scenario, config, call, emit, signal}) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < scenario.cases.length && !signal.aborted) {
      const kase = scenario.cases[next++];
      const request = {text: kase.text, ...kase.request};
      let result;
      try {
        const answer = await call(request);
        const score = scoreCase(kase, answer.data, answer.issues);
        result = {
          lane, caseId: kase.id, data: answer.data, issues: answer.issues, score, timing: answer.timing, usage: answer.usage,
          cost: costOf(lane, config, answer.timing.wallMs, answer.usage),
        };
      } catch (error) {
        if (signal.aborted) return;
        const message = error instanceof ProviderError ? error.message : 'Unerwarteter Fehler.';
        result = {lane, caseId: kase.id, error: message, score: failedScore(kase, lane === 'tractor'), timing: {wallMs: 0, stages: {}}, usage: {}, cost: null};
      }
      results.push(result);
      emit({type: 'result', ...result});
    }
  };
  await Promise.all(Array.from({length: Math.min(config.maxConcurrency, scenario.cases.length)}, worker));
  return results;
}

function laneSummary(lane, results, config) {
  const totals = summarize(results);
  const wall = results.reduce((sum, r) => sum + r.timing.wallMs, 0);
  const costs = results.map(r => r.cost);
  return {
    lane, ...totals,
    wallMsTotal: wall,
    wallMsMean: results.length ? wall / results.length : null,
    inputTokens: results.reduce((sum, r) => sum + (r.usage.inputTokens || 0), 0),
    outputTokens: results.reduce((sum, r) => sum + (r.usage.outputTokens || 0), 0),
    cost: costs.length && costs.every(c => c !== null) ? costs.reduce((a, b) => a + b, 0) : null,
    currency: config.currency,
  };
}

/** Run one scenario on tractor and, optionally, a comparison LLM. Emits NDJSON-ready events. */
export async function runExperiment({selection, config, providers, emit, signal}) {
  const {scenario, mode, schedule, warmup} = selection;
  const lanes = [{
    lane: 'tractor',
    call: request => providers.tractor({baseUrl: config.tractor.baseUrl, request, signal, timeoutMs: config.timeoutMs}),
    warm: () => providers.tractor({baseUrl: config.tractor.baseUrl, request: warmupRequest, signal, timeoutMs: config.timeoutMs}),
  }];
  if (mode === 'compare') {
    lanes.push({
      lane: 'llm',
      call: request => providers.llm({...config.llm, request, signal, timeoutMs: config.timeoutMs}),
      warm: null,
    });
  }
  emit({type: 'start', scenario: scenario.id, mode, schedule, lanes: lanes.map(l => l.lane), cases: scenario.cases.length});
  if (warmup) {
    for (const lane of lanes) {
      if (!lane.warm) continue;
      try { await lane.warm(); } catch (error) { if (signal.aborted) return; /* a cold start is measured, not hidden */ }
    }
  }
  // Clients start their stopwatch here, so warm-up never counts as processing time.
  emit({type: 'ready'});
  const run = lane => runLane({lane: lane.lane, scenario, config, call: lane.call, emit, signal});
  const all = schedule === 'parallel'
    ? await Promise.all(lanes.map(run))
    : await lanes.reduce(async (previous, lane) => [...await previous, await run(lane)], Promise.resolve([]));
  if (signal.aborted) return;
  emit({type: 'done', summaries: lanes.map((lane, i) => laneSummary(lane.lane, all[i], config))});
}
