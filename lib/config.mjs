function endpoint(value, name) {
  const text = (value ?? '').trim().replace(/\/+$/, '');
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch { throw new Error(`${name} muss eine vollständige HTTP(S)-Basis-URL sein.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name}: HTTP(S) ohne eingebettete Zugangsdaten, Query oder Fragment verwenden.`);
  }
  return text;
}

function integer(value, fallback, min, max, name) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} muss zwischen ${min} und ${max} liegen.`);
  return number;
}

function optionalNonNegative(value, name, what) {
  if (value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} muss eine nichtnegative Zahl ${what} sein.`);
  return number;
}

export function readConfig(env = process.env) {
  const currency = (env.COST_CURRENCY || 'EUR').trim().toUpperCase();
  if (!['EUR', 'USD'].includes(currency)) throw new Error('COST_CURRENCY muss EUR oder USD sein.');
  const inputPrice = optionalNonNegative(env.LLM_PRICE_INPUT_PER_MTOK, 'LLM_PRICE_INPUT_PER_MTOK', 'pro 1 Mio. Token');
  const outputPrice = optionalNonNegative(env.LLM_PRICE_OUTPUT_PER_MTOK, 'LLM_PRICE_OUTPUT_PER_MTOK', 'pro 1 Mio. Token');
  const note = (env.LLM_PRICE_NOTE || '').trim();
  const tractor = {
    baseUrl: endpoint(env.TRACTOR_URL, 'TRACTOR_URL'),
    costPerHour: optionalNonNegative(env.TRACTOR_COST_PER_HOUR, 'TRACTOR_COST_PER_HOUR', 'pro Stunde'),
  };
  const llm = {
    baseUrl: endpoint(env.LLM_BASE_URL || 'https://api.openai.com', 'LLM_BASE_URL'),
    model: (env.LLM_MODEL || '').trim(),
    apiKey: env.LLM_API_KEY || '',
    // tractor serves one worker per process; a hosted LLM API takes parallel requests.
    concurrency: integer(env.LLM_CONCURRENCY, 4, 1, 16, 'LLM_CONCURRENCY'),
    // Both prices are needed for a token-based cost; a half-configured price is ignored.
    pricing: inputPrice !== null && outputPrice !== null ? {inputPerMTok: inputPrice, outputPerMTok: outputPrice, ...(note ? {note} : {})} : null,
  };
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env.PORT, 3000, 0, 65535, 'PORT'),
    timeoutMs: integer(env.REQUEST_TIMEOUT_MS, 60000, 100, 600000, 'REQUEST_TIMEOUT_MS'),
    maxConcurrency: integer(env.MAX_CONCURRENCY, 1, 1, 8, 'MAX_CONCURRENCY'),
    tractor, llm, currency,
    version: '1.0.0',
  };
}

export const tractorConfigured = tractor => Boolean(tractor.baseUrl);
export const llmConfigured = llm => Boolean(llm.baseUrl && llm.model && llm.apiKey);

export function publicConfig(config) {
  return {
    tractor: {configured: tractorConfigured(config.tractor), costPerHour: config.tractor.costPerHour},
    llm: {configured: llmConfigured(config.llm), model: config.llm.model, pricing: config.llm.pricing},
    currency: config.currency, maxConcurrency: config.maxConcurrency, version: config.version,
    costBasis: 'tractor: gemessene Laufzeit × Ressourcensatz pro Stunde (falls konfiguriert). LLM: tatsächlich gemeldete Token × Preis pro 1 Mio. Token. Keine Rechnung, keine Strommessung.',
  };
}
