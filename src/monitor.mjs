import { scoreRound } from './scorer.mjs';
import { ProbeError } from './client.mjs';

export async function inspectTarget({ target, config, reference, client, save, sleep, budget, score = scoreRound }) {
  const record = {
    target_id: target.id, requested_model: target.model, effort: target.effort,
    started_at: new Date().toISOString(), bank_sha256: reference.bank_sha256,
    source_commit: reference.source_commit, rounds: [], probe_requests: 0,
  };
  const finish = async status => {
    record.status = status;
    record.level = status === 'warning' ? 'warning' : 'info';
    record.finished_at = new Date().toISOString();
    if (status === 'warning') {
      record.message = `Possible model mismatch for ${target.id}: requested ${target.model}; both rounds most resemble ${record.rounds.at(-1).candidate}. Review manually; no account changes were made.`;
    }
    await save(record);
    return record;
  };
  if (!reference.bank.models.some(model => model.id === target.model)) return finish('unsupported_model');
  if (budget.remaining < 6) return finish('budget_exhausted');
  for (let round = 0; round < 2; round++) {
    const samples = [];
    try {
      if (round === 1) await sleep(config.confirmation_delay_seconds * 1000);
      for (let i = 0; i < 3; i++) {
        budget.remaining--;
        record.probe_requests++;
        samples.push(await client.probe(target));
      }
    } catch (error) {
      record.error_code = error instanceof ProbeError ? error.code : 'probe_or_confirmation_failed';
      return finish('inconclusive');
    }
    const result = score(samples, target.model, reference.bank, config);
    record.rounds.push(result);
    if (result.verdict !== 'suspect') return finish(result.verdict);
    if (round === 0) {
      record.status = 'awaiting_confirmation';
      record.level = 'info';
      await save(record);
    }
  }
  if (record.rounds[0].candidate !== record.rounds[1].candidate) return finish('conflicting_rounds');
  return finish('warning');
}

export function nextTick(previous, now, interval) {
  let next = previous + interval;
  if (next <= now) next += Math.floor((now - next) / interval + 1) * interval;
  return next;
}
