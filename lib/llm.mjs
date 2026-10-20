import {ProviderError} from './errors.mjs';

const NUMERIC = new Set(['quantity', 'number', 'money', 'percent']);

function fieldSchema(spec) {
  if (spec.type === 'list') return {type: 'array', items: {type: 'string'}};
  return {type: [NUMERIC.has(spec.type) ? 'number' : 'string', 'null']};
}

/** Output rules that mirror the typed field contract, so both systems answer the same question. */
function fieldRule(spec) {
  switch (spec.type) {
    case 'quantity': return `Zahl, umgerechnet in die Einheit ${spec.unit}; null bei fehlender oder mehrdeutiger Einheit, Bereich oder Näherung`;
    case 'number': return 'Zahl mit Dezimalpunkt; null bei Bereich oder uneindeutigem Format';
    case 'money': return `Zahl in ${spec.currency} ohne Umrechnung; null bei abweichender Währung oder mehreren widersprüchlichen Beträgen`;
    case 'percent': return 'Prozentpunkte als Zahl (4,2 % → 4.2)';
    case 'date': return `ISO-Datum JJJJ-MM-TT${spec.date_order ? `; numerische Daten in Reihenfolge ${spec.date_order}` : '; numerische Daten ohne vorgegebene Reihenfolge nicht deuten (null)'}; keine relativen Angaben auflösen (null)`;
    case 'iban': return 'IBAN kompakt in Großbuchstaben ohne Leerzeichen; null bei ungültiger Prüfziffer';
    case 'identifier': return spec.format === 'vat'
      ? `Umsatzsteuer-ID ohne Länderkürzel und ohne Leerzeichen (Land ${spec.country}); null bei ungültiger Prüfziffer`
      : 'Kennung unverändert';
    case 'phone': return `Telefonnummer international ohne Leerzeichen, z. B. +4930123456${spec.country ? ` (nationale Nummern in Land ${spec.country})` : ''}`;
    case 'email': return 'E-Mail-Adresse, Domain in Kleinbuchstaben';
    case 'url': return 'Adresse wie im Text, Domain in Kleinbuchstaben, kein Schema ergänzen';
    case 'postcode': return `Postleitzahl für ${spec.country}, führende Nullen behalten`;
    case 'list': return `Liste der Werte (Trenner ${spec.separator})`;
    default: return 'Wortlaut aus dem Text, unverändert';
  }
}

export function buildPrompt(request) {
  const lines = Object.entries(request.fields).map(([name, spec]) => `- ${name}: ${spec.description} (${fieldRule(spec)})`);
  const shape = request.many
    ? `Jeder ausdrücklich beschriebene Datensatz wird durch das Feld "${request.anchor}" bestimmt; gib alle Datensätze in Textreihenfolge als Array "records" zurück.`
    : 'Gib genau einen Wert pro Feld zurück.';
  return {
    system: 'Du extrahierst ausdrücklich genannte Werte aus einem Text und gibst sie normalisiert als JSON zurück. Erfinde nichts. Ist ein Wert nicht genannt, ungültig oder mehrdeutig, lautet die Antwort null.',
    user: `Felder:\n${lines.join('\n')}\n\n${shape}\n${request.locale ? `Zahlenformat: ${request.locale}\n` : ''}\nText:\n${request.text}`,
  };
}

export function buildSchema(request) {
  const properties = Object.fromEntries(Object.entries(request.fields).map(([name, spec]) => [name, fieldSchema(spec)]));
  const object = {type: 'object', properties, required: Object.keys(properties), additionalProperties: false};
  return request.many
    ? {type: 'object', properties: {records: {type: 'array', items: object}}, required: ['records'], additionalProperties: false}
    : object;
}

export async function invokeLlm({baseUrl, model, apiKey, request, signal, timeoutMs = 60000}) {
  if (!apiKey) throw new ProviderError('CONFIG', 'LLM_API_KEY ist nicht konfiguriert.', {status: 503});
  const prompt = buildPrompt(request);
  const started = performance.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
      body: JSON.stringify({
        model,
        messages: [{role: 'system', content: prompt.system}, {role: 'user', content: prompt.user}],
        response_format: {type: 'json_schema', json_schema: {name: 'extraction', strict: true, schema: buildSchema(request)}},
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ProviderError(error?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE', 'Das Vergleichs-LLM ist nicht erreichbar.');
  }
  const wallMs = performance.now() - started;
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new ProviderError(`HTTP_${response.status}`, body?.error?.message ? `LLM: ${String(body.error.message).slice(0, 200)}` : `LLM antwortete mit HTTP ${response.status}.`);
  const choice = body?.choices?.[0];
  if (choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string') throw new ProviderError('BAD_RESPONSE', 'Das LLM lieferte keine vollständige Antwort.');
  let parsed;
  try { parsed = JSON.parse(choice.message.content); } catch { throw new ProviderError('BAD_RESPONSE', 'Das LLM lieferte kein gültiges JSON.'); }
  const data = request.many ? parsed.records : parsed;
  if (request.many ? !Array.isArray(data) : (data === null || typeof data !== 'object')) throw new ProviderError('BAD_RESPONSE', 'Das LLM lieferte nicht das erwartete Schema.');
  return {
    data, issues: null,
    timing: {wallMs, stages: {}},
    usage: {inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null},
    model: body.model || model,
  };
}
