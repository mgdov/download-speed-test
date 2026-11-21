import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http, { type RequestListener } from 'node:http';
import { parseArgs, measure, formatResult } from './download';

async function serverFor(t: TestContext, handler: RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('downloads the complete binary body exactly 10 times sequentially', async t => {
  const payload = Buffer.alloc(256 * 1024, 255);
  let requests = 0;
  let active = 0;
  let maxActive = 0;
  const url = await serverFor(t, (req, res) => {
    requests++;
    active++;
    maxActive = Math.max(maxActive, active);
    res.writeHead(200, { 'Content-Length': payload.length });
    res.write(payload.subarray(0, payload.length - 1));
    setTimeout(() => {
      active--;
      res.end(payload.subarray(payload.length - 1));
    }, 10);
  });
  const result = await measure(url);
  assert.equal(requests, 10);
  assert.equal(maxActive, 1);
  assert.equal(result.totalBytes, payload.length * 10);
  assert.ok(result.totalSeconds >= 0.1);
});

test('stops on HTTP error instead of reporting success', async t => {
  let count = 0;
  const url = await serverFor(t, (req, res) => { count++; res.writeHead(503); res.end(); });
  await assert.rejects(measure(url), /Request 1\/10 failed: HTTP 503/);
  assert.equal(count, 1);
});

test('timeout covers reading the entire response', async t => {
  const url = await serverFor(t, (req, res) => { res.writeHead(200); res.write('partial'); });
  await assert.rejects(measure(url, 80), /Request 1\/10 failed/);
});

test('truncated body fails', async t => {
  const url = await serverFor(t, (req, res) => {
    res.writeHead(200, { 'Content-Length': 100 });
    res.write('short');
    setTimeout(() => res.destroy(), 10);
  });
  await assert.rejects(measure(url), /Request 1\/10 failed/);
});

test('counts chunked responses with no Content-Length', async t => {
  const url = await serverFor(t, (req, res) => { res.write('abc'); res.end('de'); });
  assert.equal((await measure(url)).totalBytes, 50);
});

test('formats speed units and average correctly', () => {
  const output = formatResult({ totalBytes: 10_000_000, totalSeconds: 2 });
  assert.match(output, /Average request time: 0.200000 s/);
  assert.match(output, /5.000 MB\/s/);
  assert.match(output, /40.000 Mbit\/s/);
});

test('validates CLI arguments', () => {
  for (const args of [[], ['file:///etc/hosts'], ['https://example.com', '--timeout', '0'],
    ['https://example.com', '--timeout', 'NaN'], ['https://example.com', '--wrong', '5']]) {
    assert.throws(() => parseArgs(args));
  }
  assert.equal(parseArgs(['--help']), null);
  assert.equal(parseArgs(['https://example.com', '--timeout', '2'])?.timeoutMs, 2000);
});
