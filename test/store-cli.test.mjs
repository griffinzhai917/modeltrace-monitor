import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('history preserves warning details, bounds records and prevents overlapping instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modeltrace-store-'));
  let store;
  const events = [];
  try {
    store = await openStore(directory, event => events.push(event));
    await assert.rejects(() => openStore(directory), /lock/);
    for (let i = 0; i < 202; i++) await store.save({ target_id: 'route', started_at: String(i), status: 'warning', level: 'warning', rounds: [{ candidate: 'other' }], message: 'Review manually' });
    const history = JSON.parse(await readFile(path.join(directory, 'history.json')));
    assert.equal(history.length, 200); assert.equal(history[0].started_at, '2');
    assert.equal(events.at(-1).level, 'warning'); assert.equal(events.at(-1).message, 'Review manually');
    assert.equal((await stat(path.join(directory, 'history.json'))).mode & 0o777, 0o600);
    await store.close(); store = await openStore(directory, () => {});
  } finally { await store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('invalid history is not overwritten and its lock is released', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modeltrace-history-'));
  try {
    await writeFile(path.join(directory, 'history.json'), 'broken');
    await assert.rejects(() => openStore(directory), /Invalid history/);
    assert.equal(await readFile(path.join(directory, 'history.json'), 'utf8'), 'broken');
    await assert.rejects(() => stat(path.join(directory, 'monitor.lock')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI check is offline; disabled runs make no requests; unsupported targets need no key', async () => {
  const check = await exec(process.execPath, ['src/cli.mjs', '--check', 'config.example.json'], { cwd: root });
  assert.equal(JSON.parse(check.stdout).mode, 'warning_only');
  await assert.rejects(() => exec(process.execPath, ['src/cli.mjs', '--once', 'config.example.json'], { cwd: root }), error => error.stderr.includes('disabled'));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'modeltrace-cli-'));
  try {
    const config = JSON.parse(await readFile(path.join(root, 'config.example.json')));
    config.enabled = true; config.targets[0].model = 'gpt-6.1-sol';
    await writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
    const run = await exec(process.execPath, ['src/cli.mjs', '--once', path.join(directory, 'config.json')], { cwd: root });
    assert.equal(JSON.parse(run.stdout).status, 'unsupported_model');
    await assert.rejects(() => stat(path.join(directory, 'state/monitor.lock')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
