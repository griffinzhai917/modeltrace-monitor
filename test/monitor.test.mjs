import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfig } from '../src/config.mjs';
import { inspectTarget, nextTick } from '../src/monitor.mjs';
import { loadReference, scoreRound } from '../src/scorer.mjs';
import { ProbeError } from '../src/client.mjs';

const config = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url)));
const target = config.targets[0];
const reference = await loadReference();
const suspect = { verdict: 'suspect', candidate: 'gpt-6-luna', probability: 0.99, expected_probability: 0.001 };

async function scenario({ scores = [suspect, suspect], model = target.model, errorAt = Infinity, remaining = 6, saveError = false } = {}) {
  const records = [], delays = [];
  let probes = 0, scoreIndex = 0;
  const result = await inspectTarget({
    target: { ...target, model }, config, reference,
    client: { probe: async () => { if (++probes === errorAt) throw new ProbeError('http_429'); return {}; } },
    save: async record => { if (saveError && record.status === 'warning') throw new Error('disk full'); records.push(structuredClone(record)); },
    sleep: async ms => delays.push(ms), budget: { remaining }, score: () => scores[scoreIndex++],
  });
  return { result, probes, records, delays };
}

test('confirmed mismatch raises a warning after six probes and a delay, without admin methods', async () => {
  const { result, probes, records, delays } = await scenario();
  assert.equal(result.status, 'warning'); assert.equal(result.level, 'warning');
  assert.equal(probes, 6); assert.deepEqual(delays, [60000]);
  assert.equal(records[0].status, 'awaiting_confirmation');
  assert.ok(result.message.includes(target.id)); assert.ok(result.message.includes(target.model));
  assert.ok(result.message.includes(suspect.candidate));
  assert.match(result.message, /no account changes/);
});

test('unknown models and exhausted budgets make no requests', async () => {
  for (const options of [{ model: 'gpt-6.1-sol' }, { remaining: 5 }]) {
    const outcome = await scenario(options); assert.equal(outcome.probes, 0); assert.notEqual(outcome.result.status, 'warning');
  }
});

test('consistent, uncertain, conflicting and failed probes do not become mismatch warnings', async () => {
  for (const options of [
    { scores: [{ verdict: 'consistent' }] }, { scores: [{ verdict: 'inconclusive' }] },
    { scores: [suspect, { verdict: 'consistent' }] },
    { scores: [suspect, { ...suspect, candidate: 'gpt-5.6-luna' }] }, { errorAt: 2 },
  ]) {
    const outcome = await scenario(options); assert.notEqual(outcome.result.status, 'warning'); assert.equal(outcome.result.level, 'info');
  }
  assert.equal((await scenario({ errorAt: 2 })).result.error_code, 'http_429');
});

test('storage failure propagates without falsely reporting success', async () => {
  await assert.rejects(() => scenario({ saveError: true }), /disk full/);
});

test('fixed schedule skips missed ticks instead of issuing catch-up bursts', () => {
  assert.equal(nextTick(100, 150, 100), 200);
  assert.equal(nextTick(100, 200, 100), 300);
  assert.equal(nextTick(100, 451, 100), 500);
});

function sample(seed, count = 300) {
  return { count, response_model: 'private upstream text', text: JSON.stringify(Array.from({ length: count }, () => {
    seed = seed * 16807 % 2147483647; return seed % 355 + 1;
  })) };
}

test('pinned real scorer returns finite scores without retaining unknown response metadata', () => {
  const result = scoreRound([11, 23, 47].map(seed => sample(seed)), target.model, reference.bank, config);
  assert.equal(result.valid_samples, 3); assert.ok(Number.isFinite(result.probability));
  assert.deepEqual(result.response_models, ['unrecognized', 'unrecognized', 'unrecognized']);
});

test('input gate rejects unknown models, duplicates, incomplete arrays, sorted and cyclic lists', () => {
  assert.equal(scoreRound([], 'gpt-6.1-sol', reference.bank, config).verdict, 'unsupported_model');
  const valid = [11, 23, 47].map(seed => sample(seed));
  const invalid = [
    [valid[0]], [valid[0], valid[0], valid[0]],
    [{ ...valid[0], text: '1,2,3' }, valid[1], valid[2]],
    [{ ...valid[0], text: JSON.stringify(Array(299).fill(7)) }, valid[1], valid[2]],
    [{ ...valid[0], text: JSON.stringify(Array(300).fill(356)) }, valid[1], valid[2]],
    [{ ...valid[0], text: JSON.stringify(Array.from({ length: 300 }, (_, i) => i + 1)) }, valid[1], valid[2]],
    [{ ...valid[0], text: JSON.stringify(Array.from({ length: 300 }, (_, i) => i % 3 + 1)) }, valid[1], valid[2]],
  ];
  for (const samples of invalid) assert.equal(scoreRound(samples, target.model, reference.bank, config).verdict, 'inconclusive');
});

test('config accepts ordinary endpoint keys and rejects secrets, unsafe origins and old admin settings', () => {
  assert.equal(validateConfig(config), config);
  for (const patch of [{ token: 'secret' }, { auto_pause: false }, { interval_seconds: 0 }, { minimum_probability: 0.5 }, { targets: [target, target] }]) {
    assert.throws(() => validateConfig({ ...config, ...patch }));
  }
  for (const patch of [{ base_url: 'http://example.org/v1' }, { base_url: 'https://user:secret@example.org/v1' },
    { base_url: 'https://example.org/v1?key=secret' }, { api_key: 'secret' }, { admin_key_env: 'ADMIN' }, { api_key_env: ['MODELTRACE_EXAMPLE_KEY'] }]) {
    assert.throws(() => validateConfig({ ...config, targets: [{ ...target, ...patch }] }));
  }
});
