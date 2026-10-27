const isNumber = value => typeof value === 'number' && Number.isFinite(value);
// Unit conversions may be rounded; keep this relative so tiny quantities cannot become zero.
const QUANTITY_TOLERANCE = {relative: 1e-4, absolute: 0};

/** Numbers compare by value (Decimal output may differ in notation); strings exactly. */
export function sameValue(actual, expected, tolerance = {relative: 1e-9, absolute: 1e-9}) {
  if (actual === null || actual === undefined) return expected === null || expected === undefined;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, i) => sameValue(actual[i], value, tolerance));
  if (isNumber(expected)) return isNumber(actual) && Math.abs(actual - expected) <= Math.max(tolerance.absolute, tolerance.relative * Math.abs(expected));
  return actual === expected;
}

const issueKey = ({field, code, index}) => `${index ?? ''}|${field ?? ''}|${code}`;

/**
 * Score one answer against the reviewed expectation. `accept` holds offline
 * alternatives per field; they never reach the model or the service.
 */
export function scoreCase(kase, data, issues) {
  const many = Array.isArray(kase.expected.data);
  const expectedRecords = many ? kase.expected.data : [kase.expected.data];
  const actualRecords = many ? (Array.isArray(data) ? data : []) : [data];
  const fields = [];
  expectedRecords.forEach((expectedRecord, index) => {
    const actualRecord = actualRecords[index] && typeof actualRecords[index] === 'object' ? actualRecords[index] : null;
    for (const [field, expected] of Object.entries(expectedRecord)) {
      const actual = actualRecord && field in actualRecord ? actualRecord[field] : null;
      const alternatives = kase.accept?.[field] || [];
      const tolerance = kase.request?.fields?.[field]?.type === 'quantity' ? QUANTITY_TOLERANCE : undefined;
      const ok = actualRecord !== null && (sameValue(actual, expected, tolerance) || alternatives.some(alt => sameValue(actual, alt, tolerance)));
      fields.push({index: many ? index : null, field, expected, actual, ok, rejection: expected === null});
    }
  });
  const extraRecords = Math.max(0, actualRecords.length - expectedRecords.length);
  let issuesOk = null;
  if (issues) {
    const expectedKeys = new Set(kase.expected.issues.map(issueKey));
    const actualKeys = new Set(issues.map(issueKey));
    issuesOk = expectedKeys.size === actualKeys.size && [...expectedKeys].every(key => actualKeys.has(key));
  }
  const dataOk = fields.every(field => field.ok) && extraRecords === 0;
  return {fields, extraRecords, dataOk, issuesOk, exact: dataOk && issuesOk !== false};
}

/** A failed call answers nothing: every expected field counts as wrong, including expected rejections. */
export function failedScore(kase, withIssues) {
  const many = Array.isArray(kase.expected.data);
  const records = many ? kase.expected.data : [kase.expected.data];
  const fields = records.flatMap((record, index) => Object.entries(record).map(([field, expected]) => (
    {index: many ? index : null, field, expected, actual: null, ok: false, rejection: expected === null})));
  return {fields, extraRecords: 0, dataOk: false, issuesOk: withIssues ? false : null, exact: false};
}

/** Aggregate scored results; positive extraction and rejection are reported separately. */
export function summarize(scored) {
  const total = {cases: 0, exact: 0, dataOk: 0, positive: 0, positiveOk: 0, rejection: 0, rejectionOk: 0, issueCases: 0, issuesOk: 0, errors: 0};
  for (const result of scored) {
    total.cases += 1;
    if (result.error) total.errors += 1;
    total.exact += result.score.exact ? 1 : 0;
    total.dataOk += result.score.dataOk ? 1 : 0;
    for (const field of result.score.fields) {
      if (field.rejection) { total.rejection += 1; total.rejectionOk += field.ok ? 1 : 0; }
      else { total.positive += 1; total.positiveOk += field.ok ? 1 : 0; }
    }
    if (result.score.issuesOk !== null) { total.issueCases += 1; total.issuesOk += result.score.issuesOk ? 1 : 0; }
  }
  return total;
}
