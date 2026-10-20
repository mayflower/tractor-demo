// Runs every scenario against the configured tractor and prints the pipeline score.
import {scenarios} from '../data/scenarios.mjs';
import {readConfig} from '../lib/config.mjs';
import {invokeTractor} from '../lib/tractor.mjs';
import {scoreCase} from '../lib/score.mjs';

const config = readConfig();
if (!config.tractor.baseUrl) { console.error('TRACTOR_URL fehlt.'); process.exit(1); }
let misses = 0;
for (const scenario of scenarios) {
  for (const kase of scenario.cases) {
    const answer = await invokeTractor({baseUrl: config.tractor.baseUrl, request: {text: kase.text, ...kase.request}, timeoutMs: config.timeoutMs});
    const score = scoreCase(kase, answer.data, answer.issues);
    if (!score.exact) misses += 1;
    console.log(`${score.exact ? 'ok  ' : 'MISS'} ${kase.id.padEnd(7)} ${Math.round(answer.timing.wallMs)} ms  ${kase.title}`);
    if (!score.exact) console.log('     ', JSON.stringify({data: answer.data, issues: answer.issues}), '\n      erwartet', JSON.stringify(kase.expected));
  }
}
console.log(`${misses} Abweichungen`);
