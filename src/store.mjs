import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export async function openStore(directory, emit = value => console.log(JSON.stringify(value))) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, 'monitor.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error('Monitor lock exists or state directory is not writable');
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await lock.close();
    await rm(lockPath, { force: true });
  };
  const historyPath = path.join(directory, 'history.json');
  let history = [];
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    await lock.sync();
    try {
      history = JSON.parse(await readFile(historyPath, 'utf8'));
      if (!Array.isArray(history)) throw new Error('Invalid history');
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid history; refusing to overwrite'); }
  } catch (error) { await close(); throw error; }

  return {
    close,
    async save(record) {
      const next = [...history.filter(item => !(item.target_id === record.target_id && item.started_at === record.started_at)), structuredClone(record)].slice(-200);
      const tempPath = historyPath + '.tmp';
      const file = await open(tempPath, 'w', 0o600);
      try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(tempPath, historyPath);
      const dir = await open(directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
      history = next;
      emit({
        time: new Date().toISOString(), level: record.level, target_id: record.target_id,
        status: record.status, requested_model: record.requested_model,
        candidate: record.rounds.at(-1)?.candidate, message: record.message,
        error_code: record.error_code,
      });
    },
  };
}
