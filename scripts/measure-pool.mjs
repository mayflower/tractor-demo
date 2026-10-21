// Runs every candidate (demo scenarios plus edge cases) against tractor, unfiltered, and writes data/measurement.json.
// The demo shows these numbers next to the curated speed run, so the selection is never mistaken for accuracy.
// Usage: TRACTOR_URL=http://host:8000 node scripts/measure-pool.mjs --model "2026.10.21"
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {scenarios} from '../data/scenarios.mjs';
import {readConfig} from '../lib/config.mjs';
import {invokeTractor} from '../lib/tractor.mjs';
import {scoreCase} from '../lib/score.mjs';

const {values} = parseArgs({options: {model: {type: 'string', default: ''}}});
const config = readConfig();
if (!config.tractor.baseUrl) { console.error('TRACTOR_URL fehlt.'); process.exit(1); }
const blank = () => ({docs: 0, exact: 0, positive: 0, positiveOk: 0, rejection: 0, rejectionOk: 0});
const total = blank(); const byCategory = {};
for (const scenario of scenarios) {
  for (const kase of scenario.cases) {
    const category = scenario.id === 'edge' ? kase.from : scenario.id;
    const answer = await invokeTractor({baseUrl: config.tractor.baseUrl, request: {text: kase.text, ...kase.request}, timeoutMs: config.timeoutMs});
    const score = scoreCase(kase, answer.data, answer.issues);
    for (const bucket of [total, byCategory[category] ||= blank()]) {
      bucket.docs += 1; bucket.exact += score.exact ? 1 : 0;
      for (const field of score.fields) {
        if (field.rejection) { bucket.rejection += 1; bucket.rejectionOk += field.ok ? 1 : 0; }
        else { bucket.positive += 1; bucket.positiveOk += field.ok ? 1 : 0; }
      }
    }
  }
}
const measurement = {measuredAt: new Date().toISOString().slice(0, 10), model: values.model, total, byCategory};
fs.writeFileSync(new URL('../data/measurement.json', import.meta.url), JSON.stringify(measurement, null, 1) + '\n');
const pct = (a, b) => b ? `${Math.round((100 * a) / b)} %` : '–';
console.log(`Alle ${total.docs} Kandidaten: ${total.exact} Dokumente vollständig (${pct(total.exact, total.docs)}), positive Felder ${total.positiveOk}/${total.positive} (${pct(total.positiveOk, total.positive)}), Ablehnungen ${total.rejectionOk}/${total.rejection} (${pct(total.rejectionOk, total.rejection)})`);
for (const [category, b] of Object.entries(byCategory)) console.log(` ${category.padEnd(10)} Dokumente ${b.exact}/${b.docs}  Felder ${b.positiveOk}/${b.positive}  Ablehnungen ${b.rejectionOk}/${b.rejection}`);
