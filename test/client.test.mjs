import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildPayload, parseResponse, ResponsesClient } from '../src/client.mjs';
import { inspectTarget } from '../src/monitor.mjs';

const target = { id: 'test-route', base_url: '', model: 'gpt-6-astra', effort: 'high' };
const data = event => `data: ${JSON.stringify(event)}\n\n`;
const completed = { type: 'response.completed', response: { status: 'completed', model: target.model } };
const text = data({ type: 'response.output_text.delta', delta: '[1,2,3]' });

test('payload sends only a direct numerical task using the requested model and effort', () => {
  const payload = buildPayload(target, 310);
  assert.equal(payload.model, target.model); assert.equal(payload.store, false); assert.equal(payload.stream, true);
  assert.equal(payload.reasoning.effort, 'high'); assert.equal(payload.tools, undefined);
  assert.match(payload.input[0].content[0].text, /310 positions/);
});

test('Responses parser accepts completed SSE and JSON, including CRLF frames', () => {
  assert.equal(parseResponse((text + data(completed)).replace(/\n/g, '\r\n'), 'text/event-stream').text, '[1,2,3]');
  const response = { status: 'completed', model: target.model, output: [{ type: 'message', content: [{ type: 'output_text', text: '[1,2,3]' }] }] };
  assert.equal(parseResponse(JSON.stringify(response), 'application/json').text, '[1,2,3]');
  assert.equal(parseResponse(data({ ...completed, response }), 'text/event-stream').text, '[1,2,3]');
});

test('Responses parser rejects missing completion, refusals, tool calls and inconsistent output', () => {
  for (const wire of [text, text + 'data: [DONE]\n\n', 'data: bad\n\n',
    data({ type: 'response.output_item.added', item: { type: 'function_call' } }) + text + data(completed),
    text + data({ type: 'response.refusal.done' }) + data(completed),
    text + data({ ...completed, response: { status: 'incomplete' } }),
    text + data({ ...completed, response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'different' }] }] } }),
  ]) assert.throws(() => parseResponse(wire, 'text/event-stream'));
});

async function serverFor(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/v1`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('end-to-end confirmation only calls the ordinary Responses endpoint with a regular API key', async () => {
  const requests = [];
  await serverFor(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); requests.push({ path: req.url, method: req.method, auth: req.headers.authorization });
    assert.equal(payload.model, target.model); assert.equal(payload.tools, undefined);
    res.setHeader('Content-Type', 'text/event-stream'); res.end(text + data(completed));
  }, async base_url => {
    const client = new ResponsesClient('fake-test-key');
    const suspect = { verdict: 'suspect', candidate: 'gpt-6-luna' };
    const result = await inspectTarget({ target: { ...target, base_url }, config: { confirmation_delay_seconds: 10 },
      reference: { bank: { models: [{ id: target.model }] } }, client,
      save: async () => {}, sleep: async () => {}, budget: { remaining: 6 }, score: () => suspect });
    assert.equal(result.status, 'warning'); assert.equal(requests.length, 6);
    for (const request of requests) assert.deepEqual(request, { path: '/v1/responses', method: 'POST', auth: 'Bearer fake-test-key' });
  });
});

test('HTTP errors are sanitized, redirects are not followed, and response size is bounded', async () => {
  let mode = 'redirect', followed = false;
  await serverFor((req, res) => {
    if (req.url === '/other') followed = true;
    if (mode === 'redirect') { res.writeHead(302, { Location: '/other' }); res.end(); }
    else if (mode === 'large') res.end('x'.repeat((2 << 20) + 1));
    else { res.writeHead(401); res.end('secret upstream detail'); }
  }, async base_url => {
    const client = new ResponsesClient('fake-test-key');
    for (mode of ['redirect', 'large', 'error']) {
      await assert.rejects(() => client.probe({ ...target, base_url }), error => !error.message.includes('secret') &&
        ['transport_or_invalid_response', 'response_limit', 'http_401'].includes(error.code));
    }
    assert.equal(followed, false);
  });
});

test('cancellation aborts a probe without persisting network details', async () => {
  const controller = new AbortController(); controller.abort();
  const client = new ResponsesClient('fake-test-key', controller.signal);
  await assert.rejects(() => client.probe({ ...target, base_url: 'http://127.0.0.1:1/v1' }), error => error.code === 'timeout_or_cancelled');
});
