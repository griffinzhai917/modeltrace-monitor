import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateConfig } from './config.mjs';
import { ResponsesClient } from './client.mjs';
import { loadReference } from './scorer.mjs';
import { inspectTarget, nextTick } from './monitor.mjs';
import { openStore } from './store.mjs';

async function main() {
  const [mode, configPath, extra] = process.argv.slice(2);
  if (!['--check', '--once', '--run'].includes(mode) || !configPath || extra) {
    throw new Error('Usage: node src/cli.mjs --check|--once|--run <config.json>');
  }
  const config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')));
  const reference = await loadReference();
  const supported = target => reference.bank.models.some(model => model.id === target.model);
  if (mode === '--check') {
    console.log(JSON.stringify({
      valid: true, enabled: config.enabled, mode: 'warning_only', targets: config.targets.length,
      unsupported_models: config.targets.filter(target => !supported(target)).map(target => target.model),
      bank_sha256: reference.bank_sha256,
    }));
    return;
  }
  if (!config.enabled) throw new Error('Monitor is disabled; no requests made');
  if (!config.targets.length) throw new Error('Choose explicit targets first');
  const controller = new AbortController();
  const clients = new Map();
  for (const target of config.targets.filter(supported)) {
    const credential = process.env[target.api_key_env];
    if (!credential) throw new Error('Credential environment variable missing');
    clients.set(target.id, new ResponsesClient(credential, controller.signal));
  }
  const directory = path.resolve(path.dirname(path.resolve(configPath)), config.state_dir);
  const store = await openStore(directory);
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const sleep = ms => delay(ms, undefined, { signal: controller.signal });
  try {
    let nextRun = performance.now();
    do {
      const budget = { remaining: config.max_probe_requests_per_cycle };
      for (const target of config.targets) {
        if (controller.signal.aborted) break;
        await inspectTarget({ target, config, reference, client: clients.get(target.id), save: store.save, sleep, budget });
      }
      if (mode === '--once' || controller.signal.aborted) break;
      nextRun = nextTick(nextRun, performance.now(), config.interval_seconds * 1000);
      await sleep(Math.max(0, nextRun - performance.now()));
    } while (!controller.signal.aborted);
  } finally {
    await store.close();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

main().catch(error => {
  const prefixes = ['Usage:', 'Monitor ', 'Choose ', 'Credential ', 'Invalid ', 'Reference ', 'Explicit ', 'Use HTTPS', 'Request budget'];
  const message = prefixes.some(prefix => error.message.startsWith(prefix)) ? error.message : 'configuration, filesystem or probe processing error';
  console.error(error.name === 'AbortError' ? 'Monitor stopped' : `Monitor stopped: ${message}`);
  process.exitCode = error.name === 'AbortError' ? 0 : 1;
});
