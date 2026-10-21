'use strict';

const $ = id => document.getElementById(id);
const state = {config: null, scenarios: [], scenario: null, kase: null, status: {}, controller: null, runToken: 0, lanes: {}};

const ISSUES = {
  not_found: 'nicht gefunden', ambiguous_value: 'mehrdeutig · alle Kandidaten', ambiguous_record: 'mehrere Datensätze',
  invalid_iban: 'ungültige IBAN', invalid_identifier: 'ungültige Kennung', currency_mismatch: 'Währung passt nicht',
  missing_or_multiple_currency: 'Währung unklar', ambiguous_or_unsupported_date: 'Datum nicht eindeutig',
  missing_unit: 'Einheit fehlt', non_scalar_quantity: 'Bereich oder Näherung', ambiguous_unit: 'Einheit mehrdeutig',
  unsupported_unit: 'Einheit unbekannt', unsupported_number_format: 'Zahlenformat nicht unterstützt',
  invalid_number_format: 'ungültiges Zahlenformat', invalid_money_format: 'Betrag nicht lesbar',
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const ms = v => v === null || v === undefined ? '–' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
const show = v => v === null || v === undefined ? 'null' : Array.isArray(v) ? v.map(show).join('  |  ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
/** Competing candidates render as separate amber chips, so they cannot be mistaken for one value or for records. */
function valueNode(value, {ambiguous = false, cls = 'value'} = {}) {
  if (Array.isArray(value) && value.length > 1 && ambiguous) {
    return el('div', {class: `${cls} cands`}, value.map(v => el('span', {class: 'cand', text: show(v)})));
  }
  return el('div', {class: `${cls}${value === null || value === undefined ? ' null' : ''}`, text: show(value)});
}
const isAmbiguous = (issues, name, index) => issues.some(i => i.code === 'ambiguous_value' && i.field === name && (index === undefined || i.index === undefined || i.index === index));
const typeLabel = spec => [spec.type, spec.unit, spec.currency, spec.country, spec.format].filter(Boolean).join(' · ');

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function showError(message) { $('error').hidden = !message; $('error').textContent = message || ''; }

/* ---------- navigation ---------- */

function renderTabs() {
  $('tabs').replaceChildren(...state.scenarios.map(s => {
    const b = el('button', {class: 'tab', type: 'button', 'aria-selected': String(s === state.scenario), text: s.title});
    b.addEventListener('click', () => { if (!state.controller) selectScenario(s); });
    return b;
  }));
}

function renderChips() {
  $('chips').replaceChildren(...state.scenario.cases.map((c, i) => {
    const b = el('button', {class: `chip-btn ${state.status[c.id] || ''}`, type: 'button', 'aria-pressed': String(c === state.kase), title: c.title, 'aria-label': `${i + 1}: ${c.title}`, text: String(i + 1)});
    b.addEventListener('click', () => { if (!state.controller) selectCase(c, true); });
    return b;
  }));
}

const demoScenarios = () => state.scenarios.filter(s => s.id !== 'edge');
const demoCases = () => demoScenarios().flatMap(s => s.cases);

function renderRunHeader() {
  const edge = state.scenario.id === 'edge';
  const count = edge ? state.scenario.cases.length : demoCases().length;
  $('runTitle').textContent = edge ? 'Grenzfälle messen' : 'Speed-Run';
  $('runHint').textContent = edge ? `Alle ${count} Grenzfälle nacheinander.` : `Alle ${count} Dokumente aus allen fünf Demos, nacheinander verarbeitet.`;
  $('measure').textContent = edge ? 'Grenzfälle messen' : 'Speed-Run starten';
  $('selectionNote').textContent = edge
    ? 'Hier scheitert tractor in dieser Prüfung. Die Erwartungen wurden nicht an die Ausgabe angepasst.'
    : `Die fünf Demos zeigen Fälle, die tractor löst; die übrigen Kandidaten stehen unter „Grenzfälle“. Das ist eine Auswahl, keine Genauigkeitsmessung.`;
}

function selectScenario(scenario) {
  state.scenario = scenario;
  state.status = {};
  $('score').replaceChildren();
  renderTabs();
  renderRunHeader();
  selectCase(scenario.cases[0], true);
}

function selectCase(kase, autorun) {
  state.kase = kase;
  $('caseTitle').textContent = kase.title;
  $('text').value = kase.text;
  $('request').value = JSON.stringify(kase.request, null, 2);
  $('edited').hidden = true;
  showError('');
  renderChips();
  if (autorun && state.config.tractor.configured) extract();
  else renderPreview();
}

function markEdited() {
  if (!state.kase) return;
  state.kase = null;
  $('caseTitle').textContent = 'eigene Fassung';
  $('edited').hidden = false;
  renderChips();
}

/* ---------- result cards ---------- */

function fieldCard(name, spec, value, opts) {
  const {issues = [], entry, llmEntry, llmValue, llmOn, delay} = opts;
  const ambiguous = Array.isArray(value) && issues.some(i => i.code === 'ambiguous_value');
  const classes = ['field', ambiguous ? 'ambiguous' : '', entry ? (entry.ok ? 'ok' : 'miss') : ''].join(' ');
  const card = el('div', {class: classes, style: `animation-delay:${delay}ms`});
  card.append(el('div', {class: 'field-head'}, el('span', {text: spec.description}), el('span', {class: 'type', text: typeLabel(spec)})));
  card.append(valueNode(value, {ambiguous}));
  for (const issue of issues) {
    const many = issue.code === 'ambiguous_value' && Array.isArray(value) ? `mehrdeutig · ${value.length} Kandidaten, keiner gewählt` : null;
    card.append(el('span', {class: `badge ${many ? 'amber' : entry && !entry.ok ? 'miss' : ''}`, title: issue.code, text: many ? `⚠ ${many}` : (ISSUES[issue.code] || issue.code)}), ' ');
  }
  if (entry && !entry.ok) card.append(el('div', {class: 'soll', text: `Soll: ${show(entry.expected)}`}));
  if (llmOn) {
    card.append(el('div', {class: `llm ${llmEntry ? (llmEntry.ok ? 'ok' : 'miss') : ''}`}, el('span', {}, 'LLM ', el('span', {class: 'mk', text: llmEntry ? (llmEntry.ok ? '✓' : '✗') : ''})), el('span', {class: 'v'}, Array.isArray(llmValue) && llmValue.length > 1 ? llmValue.map(v => el('span', {class: 'cand cand-llm', text: show(v)})) : show(llmValue))));
  }
  return card;
}

function renderResult(request, t, l) {
  const box = $('result');
  if (!t) return;
  if (!t.ok) { box.replaceChildren(el('p', {class: 'placeholder', text: t.error})); return; }
  const many = Boolean(request.many);
  const records = many ? t.data : [t.data];
  const llmRecords = l?.ok ? (many ? l.data : [l.data]) : [];
  const nodes = [];
  let delay = 0;
  if (many && !records.length) nodes.push(el('p', {class: 'placeholder', text: 'Keine Datensätze gefunden.'}));
  records.forEach((record, index) => {
    const group = many ? el('div', {class: 'record'}, el('h3', {text: `Datensatz ${index + 1}`})) : box;
    const cards = Object.entries(request.fields).map(([name, spec]) => {
      const issues = t.issues.filter(i => i.field === name && (many ? i.index === index : true));
      const entry = t.score?.fields.find(f => f.field === name && f.index === (many ? index : null));
      const llmEntry = l?.score?.fields.find(f => f.field === name && f.index === (many ? index : null));
      return fieldCard(name, spec, record?.[name], {issues, entry, llmEntry, llmValue: llmRecords[index]?.[name], llmOn: Boolean(l?.ok), delay: (delay += 45)});
    });
    if (many) { group.append(...cards); nodes.push(group); } else nodes.push(...cards);
  });
  const recordIssues = t.issues.filter(i => !i.field);
  if (recordIssues.length) nodes.push(el('p', {class: 'placeholder'}, recordIssues.map(i => el('span', {class: 'badge', text: ISSUES[i.code] || i.code}))));
  if (t.score?.extraRecords) nodes.push(el('p', {class: 'placeholder', text: `${t.score.extraRecords} Datensatz zu viel`}));
  if (l && !l.ok) nodes.push(el('p', {class: 'placeholder', text: `LLM: ${l.error}`}));
  box.replaceChildren(...nodes);
}

/** Before anything runs: the typed fields the request asks for. */
function renderPreview() {
  let request;
  try { request = JSON.parse($('request').value); } catch { return; }
  $('result').replaceChildren(...Object.entries(request.fields || {}).map(([name, spec]) => fieldCard(name, spec, '…', {delay: 0})).map(c => { c.classList.add('pending'); return c; }));
}

/* ---------- speed: live lanes ---------- */

const STAGES = [['queue', 'Warteschlange', '#9aa49b'], ['preprocess', 'Vorverarbeitung', '#5b8def'], ['inference', 'Modell', '#227a52'], ['normalize', 'Normalisierung', '#d9a441']];
const tickers = new Set();
let frame = 0;
function tick() {
  const now = performance.now();
  for (const lane of tickers) lane.update(now);
  // A finished lane's bar is relative to the slower lane, so repaint all race lanes each frame.
  for (const lane of Object.values(state.lanes)) lane.paint();
  frame = tickers.size ? requestAnimationFrame(tick) : 0;
}
function startTicker(lane) { tickers.add(lane); if (!frame) frame = requestAnimationFrame(tick); }

/** A lane is one system's row: name, bar, big timer. `total` switches it to progress mode (Speed-Run). */
function makeLane(key, label, {total = null, scale = () => 1} = {}) {
  const time = el('div', {class: 'time', text: '–'});
  const bar = el('i');
  const node = el('div', {class: `lane ${key}`}, el('div', {class: 'name', text: label}), el('div', {class: 'track'}, bar), time);
  const lane = {key, node, total, done: 0, startedAt: null, finishedAt: null, elapsed: 0,
    start() { this.startedAt = performance.now(); this.finishedAt = null; this.done = 0; startTicker(this); },
    finish(ms) { this.finishedAt = this.startedAt + ms; this.elapsed = ms; tickers.delete(this); paint(); },
    update(now) { this.elapsed = (this.finishedAt ?? now) - this.startedAt; paint(); },
    stages: null, extra: null};
  const paint = () => {
    time.textContent = lane.startedAt === null ? '–' : ms(lane.elapsed);
    const width = total ? lane.done / total : Math.min(1, lane.elapsed / Math.max(scale(), lane.elapsed, 1));
    bar.style.width = `${Math.round(width * 100)}%`;
    lane.onPaint?.();
  };
  lane.paint = paint;
  return lane;
}

function stageBlock(timing) {
  const parts = STAGES.map(([k, name, color]) => ({name, color, value: timing.stages[k]})).filter(p => p.value !== undefined);
  const network = Math.max(0, timing.wallMs - parts.reduce((a, p) => a + p.value, 0));
  parts.push({name: 'Netz', color: '#c9cfc6', value: network});
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return [
    el('div', {class: 'stages'}, parts.map(p => el('i', {style: `width:${(p.value / total) * 100}%;background:${p.color}`, title: p.name}))),
    el('div', {class: 'stage-legend'}, parts.map(p => el('span', {}, el('span', {class: 'sw', style: `background:${p.color}`}), `${p.name} `, el('b', {text: ms(p.value)})))),
  ];
}

function setupRace(compare) {
  const scale = () => Math.max(...Object.values(state.lanes).map(l => l.elapsed), 1);
  state.lanes = {tractor: makeLane('tractor', 'tractor', {scale})};
  if (compare) state.lanes.llm = makeLane('llm', 'LLM', {scale});
  $('race').replaceChildren(...Object.values(state.lanes).map(l => l.node), el('div', {class: 'speedup', id: 'speedup'}));
}

function showSpeedup() {
  const {tractor, llm} = state.lanes;
  if (tractor?.finishedAt && llm?.finishedAt && tractor.elapsed > 0) {
    const factor = llm.elapsed / tractor.elapsed;
    $('speedup').textContent = factor >= 1.1 ? `tractor ist ${factor < 10 ? factor.toFixed(1) : Math.round(factor)}× schneller` : 'ungefähr gleich schnell';
  }
}

async function callLane(lane, request) {
  const body = state.kase
    ? {caseId: state.kase.id, lane}
    : {request: {...request, text: $('text').value}, lane};
  return (await api('/api/extract', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})).result;
}

async function extract() {
  showError('');
  let request;
  try { request = JSON.parse($('request').value); } catch { return showError('Die Felddefinition ist kein gültiges JSON.'); }
  const token = ++state.runToken;
  const compare = $('compare').checked;
  setupRace(compare);
  $('run').disabled = true;
  renderPreview();
  const results = {};
  const pending = ['tractor', ...(compare ? ['llm'] : [])].map(async key => {
    const lane = state.lanes[key];
    lane.start();
    try {
      const result = await callLane(key, request);
      if (token !== state.runToken) return;
      results[key] = result;
      // The measured server-side round trip is the number shown; the timer only animates until it arrives.
      lane.finish(result.ok ? result.timing.wallMs : performance.now() - lane.startedAt);
      if (key === 'tractor' && result.ok) {
        lane.node.append(...stageBlock(result.timing));
        if (state.kase && result.score) { state.status[state.kase.id] = result.score.exact ? 'ok' : 'miss'; renderChips(); }
      }
      renderResult(request, results.tractor, results.llm);
      showSpeedup();
    } catch (error) {
      if (token === state.runToken) { lane.finish(performance.now() - lane.startedAt); showError(error.message); }
    }
  });
  await Promise.all(pending);
  if (token === state.runToken) $('run').disabled = false;
}

/* ---------- Speed-Run over every demo document ---------- */

function renderScore(summaries) {
  $('score').replaceChildren(...summaries.map(s => el('div', {class: 'score-line'},
    `${s.lane === 'llm' ? 'LLM' : 'tractor'}: `, el('b', {text: `${s.exact}/${s.cases}`}), ' Dokumente exakt · Felder ', el('b', {text: `${s.positiveOk}/${s.positive}`}),
    ' · Ablehnungen ', el('b', {text: `${s.rejectionOk}/${s.rejection}`}), ` · Ø ${ms(s.wallMsMean)}`,
    s.cost !== null && s.cost !== undefined ? ` · ${s.cost.toFixed(5)} ${s.currency}` : '')));
}

/** One line of values: competing candidates become chips, records are separated by a bar. */
function compactValues(data, issues) {
  const records = Array.isArray(data) ? data : [data || {}];
  const nodes = [];
  records.forEach((record, index) => {
    if (index) nodes.push(el('span', {class: 'rec-sep', text: '┃'}));
    Object.entries(record).forEach(([name, value], i) => {
      if (i) nodes.push(' · ');
      const ambiguous = Array.isArray(value) && isAmbiguous(issues || [], name, Array.isArray(data) ? index : undefined);
      nodes.push(ambiguous ? el('span', {class: 'cand-group'}, value.map(v => el('span', {class: 'cand', text: show(v)}))) : show(value));
    });
  });
  return nodes;
}

/** One column per system; every document gets a row that fills in when its result arrives. */
function makeColumn(key, label, cases) {
  const clock = el('span', {class: 'clock', text: '0 ms'});
  const count = el('span', {class: 'count'});
  const rows = new Map(cases.map(c => {
    const time = el('span', {class: 'row-time', text: '…'});
    const bar = el('i');
    const values = el('div', {class: 'row-values'});
    const mark = el('span', {class: 'mark'});
    const node = el('li', {class: 'row pending'}, el('div', {class: 'row-main'}, mark, el('span', {class: 'row-title', text: c.title}), time), el('div', {class: 'row-bar'}, bar), values);
    return [c.id, {node, time, bar, values, mark, ms: null}];
  }));
  const node = el('section', {class: `column lane-${key}`}, el('header', {}, el('h3', {text: label}), el('div', {class: 'col-stats'}, clock, count)), el('ol', {class: 'rows'}, [...rows.values()].map(r => r.node)));
  const column = {key, node, rows, done: 0, total: cases.length, startedAt: performance.now(), finishedAt: null, update(now) {
    const elapsed = (this.finishedAt ?? now) - this.startedAt;
    clock.textContent = ms(elapsed);
    const rate = elapsed > 0 ? this.done / (elapsed / 1000) : 0;
    count.textContent = `${this.done}/${this.total} · ${rate.toFixed(rate < 10 ? 1 : 0)} Dok/s`;
  }};
  column.update(column.startedAt);
  return column;
}

function fillRow(column, event, scale) {
  const row = column.rows.get(event.caseId);
  row.node.classList.remove('pending');
  const ok = event.score.exact;
  row.node.classList.add(event.error ? 'miss' : ok ? 'ok' : 'miss');
  row.mark.textContent = event.error ? '!' : ok ? '✓' : '✗';
  row.ms = event.error ? null : event.timing.wallMs;
  row.time.textContent = event.error ? 'Fehler' : ms(event.timing.wallMs);
  row.values.replaceChildren(...(event.error ? [event.error] : compactValues(event.data, event.issues)));
  if (!event.error && event.issues?.length) row.values.append(' ', ...event.issues.map(i => el('span', {class: `badge${i.code === 'ambiguous_value' ? ' amber' : ''}`, title: i.code, text: i.code === 'ambiguous_value' ? '⚠ mehrdeutig' : (ISSUES[i.code] || i.code)})));
  column.done += 1;
  rescale(scale);
}

/** Latency bars share one scale across both systems, so the difference is visible row by row. */
function rescale(columns) {
  const max = Math.max(1, ...columns.flatMap(c => [...c.rows.values()].map(r => r.ms || 0)));
  for (const column of columns) for (const row of column.rows.values()) row.bar.style.width = row.ms ? `${Math.max(1.5, (row.ms / max) * 100)}%` : '0';
}

async function measure() {
  const edge = state.scenario.id === 'edge';
  const cases = edge ? state.scenario.cases : demoCases();
  const compare = $('compare').checked;
  state.controller = new AbortController();
  state.status = {};
  renderChips();
  $('measure').hidden = true;
  $('stop').hidden = false;
  $('score').replaceChildren();
  showError('');
  const columns = {tractor: makeColumn('tractor', 'tractor', cases)};
  if (compare) columns.llm = makeColumn('llm', 'LLM', cases);
  const all = Object.values(columns);
  $('runLanes').className = `run-columns${compare ? ' two' : ''}`;
  $('runLanes').replaceChildren(...all.map(c => c.node));
  const clockTick = () => { const now = performance.now(); for (const c of all) if (!c.finishedAt) c.update(now); if (state.controller) requestAnimationFrame(clockTick); };
  requestAnimationFrame(clockTick);
  try {
    const response = await fetch('/api/run', {method: 'POST', headers: {'content-type': 'application/json'}, signal: state.controller.signal,
      body: JSON.stringify({scenario: edge ? 'edge' : 'all', mode: compare ? 'compare' : 'tractor', schedule: 'parallel', warmup: true})});
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += value;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'ready') for (const c of all) c.startedAt = performance.now();
        else if (event.type === 'result') {
          const column = columns[event.lane];
          fillRow(column, event, all);
          if (column.done === column.total) { column.finishedAt = performance.now(); column.update(column.finishedAt); }
          if (event.lane === 'tractor') { state.status[event.caseId] = event.score.exact ? 'ok' : 'miss'; renderChips(); }
        } else if (event.type === 'done') renderScore(event.summaries);
        else if (event.type === 'error') throw new Error(event.message);
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') showError(error.message);
  } finally {
    state.controller = null;
    for (const c of all) c.update(performance.now());
    $('measure').hidden = false;
    $('stop').hidden = true;
  }
}

async function health() {
  const pill = $('connection');
  try {
    const result = await api('/api/health');
    const t = result.tractor;
    pill.className = `pill ${t.ok ? 'ok' : 'bad'}`;
    pill.textContent = t.ok ? `tractor bereit · ${ms(t.latencyMs)}` : `tractor: ${t.message}`;
  } catch (error) { pill.className = 'pill bad'; pill.textContent = error.message; }
}

async function init() {
  try {
    [state.config, {scenarios: state.scenarios}] = await Promise.all([api('/api/config'), api('/api/scenarios')]);
  } catch (error) { showError(error.message); return; }
  // The race against the LLM is the default; without a configured LLM the box stays off and disabled.
  $('compare').checked = state.config.llm.configured;
  if (!state.config.llm.configured) { $('compare').disabled = true; $('compare').parentElement.title = 'LLM_MODEL und LLM_API_KEY nicht konfiguriert'; }
  $('run').addEventListener('click', extract);
  $('text').addEventListener('input', markEdited);
  $('request').addEventListener('input', markEdited);
  $('text').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) extract(); });
  $('measure').addEventListener('click', measure);
  $('stop').addEventListener('click', () => state.controller?.abort());
  const configured = state.config.tractor.configured;
  $('run').disabled = !configured;
  $('measure').disabled = !configured;
  $('connection').textContent = configured ? 'Verbindung …' : 'Datenvorschau (TRACTOR_URL fehlt)';
  selectScenario(state.scenarios[0]);
  if (configured) health();
}

init();
