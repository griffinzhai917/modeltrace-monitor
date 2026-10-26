import { randomInt } from 'node:crypto';

export class ProbeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function buildPayload(target, count) {
  const text = `For each of ${count} positions, make one separate first-instinct choice of an integer from 1 to 355 inclusive. Use only the language model itself, without tools, Python, code execution, calculators, search, APIs or external random generators. Do not count upward or downward, use an arithmetic progression, repeating cycle or rule-made pattern. Accidental repetitions are valid. Do not sort, deduplicate or repair the list. Return exactly one JSON array of integers and no explanation.`;
  return {
    model: target.model, stream: true, store: false,
    instructions: "Follow the user's output requirements directly. Do not use tools.",
    input: [{ role: 'user', content: [{ type: 'input_text', text }] }],
    ...(target.effort ? { reasoning: { effort: target.effort } } : {}),
  };
}

function completionText(response) {
  if (response?.status !== 'completed') throw new ProbeError('incomplete_response');
  let text = '';
  for (const item of response.output || []) {
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message') throw new ProbeError('unexpected_tool_output');
    if (!Array.isArray(item.content)) throw new ProbeError('invalid_response');
    for (const part of item.content) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') throw new ProbeError('invalid_response');
      text += part.text;
    }
  }
  return text;
}

export function parseResponse(wire, contentType) {
  if (contentType.includes('application/json')) {
    const response = JSON.parse(wire);
    const text = completionText(response);
    if (!text || text.length > 65536) throw new ProbeError('invalid_response');
    return { text, response_model: response.model };
  }
  if (!contentType.includes('text/event-stream')) throw new ProbeError('unsupported_response_format');
  let delta = '', completed;
  for (const frame of wire.replace(/\r\n/g, '\n').split('\n\n')) {
    if (frame.length > 262144) throw new ProbeError('response_limit');
    const data = frame.split('\n').filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    if (data === '[DONE]') break;
    const event = JSON.parse(data);
    if (completed) throw new ProbeError('events_after_completion');
    if (['error', 'response.failed', 'response.incomplete', 'response.refusal.delta', 'response.refusal.done'].includes(event.type)) {
      throw new ProbeError('incomplete_response');
    }
    if (event.type === 'response.output_item.added' && !['message', 'reasoning'].includes(event.item?.type)) {
      throw new ProbeError('unexpected_tool_output');
    }
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') throw new ProbeError('invalid_response');
      delta += event.delta;
      if (delta.length > 65536) throw new ProbeError('response_limit');
    }
    if (event.type === 'response.completed') {
      const final = completionText(event.response);
      if (final && delta && final !== delta) throw new ProbeError('inconsistent_completion');
      completed = { text: final || delta, response_model: event.response.model };
    }
  }
  if (!completed?.text || completed.text.length > 65536) throw new ProbeError('missing_completion');
  return completed;
}

export class ResponsesClient {
  constructor(credential, signal) { this.credential = credential; this.signal = signal; }

  async probe(target) {
    const count = randomInt(292, 333);
    const url = new URL(target.base_url);
    url.pathname = url.pathname.replace(/\/+$/, '') + '/responses';
    const signal = AbortSignal.any([AbortSignal.timeout(120000), ...(this.signal ? [this.signal] : [])]);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${this.credential}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(buildPayload(target, count)),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProbeError(`http_${response.status}`);
      }
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 2 << 20) throw new ProbeError('response_limit');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const parsed = parseResponse(Buffer.concat(chunks).toString('utf8'), response.headers.get('content-type') || '');
      return { ...parsed, count };
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      throw new ProbeError(signal.aborted ? 'timeout_or_cancelled' : 'transport_or_invalid_response');
    }
  }
}
