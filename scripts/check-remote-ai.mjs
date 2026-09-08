import Sanitizer from '../packages/ai/src/evidence-sanitizer.js';
const base = 'https://privacy-mirror-analysis-blazetiger10-5946s-projects.vercel.app';
const now = Date.now();
const evidence = Sanitizer.sanitizeHistory({ sites: { 'synthetic.example': { hours: { [now - 3600000]: { total: 100, access: { dangerous: 30, suspicious: 40, benign: 30 }, outcomes: { defended: 20, perturbed: 15, cleaned: 5 }, categories: { canvas: 40, network: 30, storage: 30 } } } } } }, { now, hours: 24 });
const checks = await Promise.all([
  ['FAST', '/api/ai/analyze', { ...evidence, mode: 'MANUAL' }, 100000],
  ['RESEARCH', '/api/ai/research', { ...evidence, mode: 'RESEARCH' }, 190000]
].map(async ([expected, endpoint, body, timeout]) => {
  const started = Date.now();
  const response = await fetch(base + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  return { expected, http: response.status, status: result.status, route: result.route, reason: result.reason, classification: result.analysis?.classification, explanationPresent: Boolean(result.analysis?.explanation?.length), elapsedMs: Date.now() - started };
}));
for (const check of checks) console.log(JSON.stringify(check));
if (checks.some(check => check.status !== 'OK' || check.route !== check.expected)) process.exitCode = 1;
