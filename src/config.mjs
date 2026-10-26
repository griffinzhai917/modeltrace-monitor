export function requireKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('Invalid configuration fields');
  }
}

export function validateConfig(config) {
  requireKeys(config, ['enabled', 'interval_seconds', 'confirmation_delay_seconds',
    'max_probe_requests_per_cycle', 'minimum_probability', 'maximum_expected_probability',
    'state_dir', 'targets']);
  if (typeof config.enabled !== 'boolean' || typeof config.state_dir !== 'string' || !config.state_dir.trim()) {
    throw new Error('Explicit enabled flag and state directory required');
  }
  for (const [key, min, max] of [
    ['interval_seconds', 300, 604800], ['confirmation_delay_seconds', 10, 3600],
    ['max_probe_requests_per_cycle', 6, 600],
  ]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(`Invalid ${key}`);
    }
  }
  if (!Number.isFinite(config.minimum_probability) || config.minimum_probability < 0.9 || config.minimum_probability > 1 ||
      !Number.isFinite(config.maximum_expected_probability) || config.maximum_expected_probability < 0 || config.maximum_expected_probability > 0.1) {
    throw new Error('Invalid decision thresholds');
  }
  if (!Array.isArray(config.targets) || config.targets.length > 100) throw new Error('Invalid targets');
  const ids = new Set();
  for (const target of config.targets) {
    requireKeys(target, ['id', 'base_url', 'api_key_env', 'model', 'effort']);
    if (['id', 'base_url', 'api_key_env', 'model', 'effort'].some(key => typeof target[key] !== 'string') ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(target.id) || ids.has(target.id) ||
        !/^[A-Z][A-Z0-9_]{0,100}$/.test(target.api_key_env) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(target.model) ||
        !['', 'low', 'medium', 'high', 'xhigh'].includes(target.effort)) {
      throw new Error('Invalid or duplicate target');
    }
    const url = new URL(target.base_url);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
      throw new Error('Use HTTPS or loopback HTTP without credentials or query parameters');
    }
    ids.add(target.id);
  }
  if (config.targets.length * 6 > config.max_probe_requests_per_cycle) {
    throw new Error('Request budget must cover six possible probes per target');
  }
  return config;
}
