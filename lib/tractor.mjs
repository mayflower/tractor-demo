import {ProviderError} from './errors.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Parse `queue;dur=0.1, inference;dur=12.3` into milliseconds per stage. */
export function parseServerTiming(header) {
  const stages = {};
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.trim().split(';');
    const dur = params.map(p => p.trim()).find(p => p.startsWith('dur='));
    if (name && dur && Number.isFinite(Number(dur.slice(4)))) stages[name] = Number(dur.slice(4));
  }
  return stages;
}

/** One call to the single public extraction endpoint, POST /v1/extract. */
export async function invokeTractor({baseUrl, request, signal, timeoutMs = 60000}) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/extract`, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json'},
      body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const timeout = error?.name === 'TimeoutError';
    throw new ProviderError(timeout ? 'TIMEOUT' : 'UNREACHABLE', timeout ? 'tractor antwortet nicht rechtzeitig.' : 'tractor ist nicht erreichbar.', {status: 502});
  }
  const wallMs = performance.now() - started;
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const detail = record(body?.error) ? body.error : {};
    throw new ProviderError(detail.code || `HTTP_${response.status}`, detail.message || `tractor antwortete mit HTTP ${response.status}.`, {status: response.status === 503 ? 503 : 502});
  }
  if (!record(body) || !Array.isArray(body.issues) || !(record(body.data) || Array.isArray(body.data))) {
    throw new ProviderError('BAD_RESPONSE', 'tractor lieferte kein data/issues-Objekt.');
  }
  return {
    data: body.data,
    issues: body.issues,
    timing: {wallMs, stages: parseServerTiming(response.headers.get('server-timing'))},
    usage: {inputTokens: Number(response.headers.get('x-tractor-input-tokens')) || null},
  };
}

export async function tractorReady({baseUrl, signal, timeoutMs = 5000}) {
  const response = await fetch(`${baseUrl}/readyz`, {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)});
  return response.ok;
}

export const warmupRequest = {
  text: 'Die Breite beträgt 12,5 cm.',
  fields: {width: {type: 'quantity', description: 'Breite', unit: 'mm'}},
  locale: 'de-DE',
};
