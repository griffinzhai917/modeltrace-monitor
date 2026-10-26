import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { analyzeGlobalOutputs } from '../third_party/modeltrace/fingerprint-core.mjs';

export async function loadReference() {
  const root = new URL('../third_party/modeltrace/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'));
  for (const [name, entry] of Object.entries(provenance.files)) {
    const hash = createHash('sha256').update(await readFile(new URL(name, root))).digest('hex');
    if (hash !== entry.sha256) throw new Error('Reference artifact checksum mismatch');
  }
  return {
    bank: JSON.parse(await readFile(new URL('unified_bank.json', root), 'utf8')),
    bank_sha256: provenance.files['unified_bank.json'].sha256,
    source_commit: provenance.commit,
  };
}

export function scoreRound(samples, expected, bank, config) {
  if (!bank.models.some(model => model.id === expected)) return { verdict: 'unsupported_model' };
  if (samples.length !== 3 || new Set(samples.map(sample => sample.text)).size !== 3) return { verdict: 'inconclusive' };
  for (const sample of samples) {
    let values;
    try { values = JSON.parse(sample.text); } catch { return { verdict: 'inconclusive' }; }
    if (!Number.isInteger(sample.count) || sample.count < 292 || sample.count > 332 ||
        !Array.isArray(values) || values.length !== sample.count ||
        values.some(n => !Number.isInteger(n) || n < 1 || n > 355)) return { verdict: 'inconclusive' };
    if (values.every((n, i) => i === 0 || n >= values[i - 1]) ||
        values.every((n, i) => i === 0 || n <= values[i - 1])) return { verdict: 'inconclusive' };
    for (let period = 1; period <= 16; period++) {
      if (values.every((n, i) => i < period || n === values[i - period])) return { verdict: 'inconclusive' };
    }
  }
  const outputs = samples.map(sample => ({ text: sample.text, expected_count: sample.count }));
  const aggregate = analyzeGlobalOutputs(outputs, bank);
  const individual = outputs.map(output => analyzeGlobalOutputs([output], bank).prediction);
  const expectedProbability = aggregate.results.find(result => result.model === expected)?.probability;
  const result = {
    candidate: aggregate.prediction, probability: aggregate.probability,
    expected_probability: expectedProbability, sample_candidates: individual, valid_samples: 3,
    response_models: samples.map(sample => bank.models.some(model => model.id === sample.response_model) ? sample.response_model : 'unrecognized'),
  };
  if (aggregate.prediction === expected) return { ...result, verdict: 'consistent' };
  if (individual.every(model => model === aggregate.prediction) &&
      aggregate.probability >= config.minimum_probability && expectedProbability <= config.maximum_expected_probability) {
    return { ...result, verdict: 'suspect' };
  }
  return { ...result, verdict: 'inconclusive' };
}
