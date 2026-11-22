import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const script = path.join(__dirname, 'download.js');

test('проверяем настоящий CLI на локальном сервере', async t => {
  const file = Buffer.alloc(256 * 1024, 255);
  let requests = 0;
  let active = 0;
  let maxActive = 0;

  const server = http.createServer((request, response) => {
    if (request.url === '/error') {
      response.writeHead(503);
      response.end();
      return;
    }
    requests++;
    active++;
    maxActive = Math.max(maxActive, active);
    response.writeHead(200, { 'Content-Length': file.length });
    response.write(file.subarray(0, file.length - 1));
    setTimeout(() => {
      active--;
      response.end(file.subarray(file.length - 1));
    }, 15);
  });

  // once превращает событие в Promise; ошибка запуска тоже отклонит его.
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;

  await t.test('10 последовательных полных ответов и верные формулы', async () => {
    const { stdout, stderr } = await run(process.execPath, [script, url]);
    assert.equal(stderr, '');
    assert.equal(requests, 10);
    assert.equal(maxActive, 1);
    assert.ok(stdout.includes(`Скачано: ${file.length * 10} байт`));
    const seconds = Number(stdout.match(/Общее время: ([\d.]+)/)?.[1]);
    const average = Number(stdout.match(/Среднее время: ([\d.]+)/)?.[1]);
    const mb = Number(stdout.match(/Скорость: ([\d.]+) MB\/s/)?.[1]);
    const mbit = Number(stdout.match(/Скорость: ([\d.]+) Mbit\/s/)?.[1]);
    assert.ok(seconds >= 0.15);
    assert.ok(Math.abs(average - seconds / 10) < 0.000002);
    assert.ok(Math.abs(mb - file.length * 10 / seconds / 1_000_000) < 0.002);
    assert.ok(Math.abs(mbit - mb * 8) < 0.005);
  });

  await t.test('HTTP-ошибка даёт ненулевой код и не печатает скорость', async () => {
    try {
      await run(process.execPath, [script, url + '/error']);
      assert.fail('Ожидалась ошибка процесса');
    } catch (error) {
      const result = error as Error & { code: number; stdout: string; stderr: string };
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /HTTP 503/);
    }
  });

  await t.test('без URL программа выводит инструкцию и код ошибки', async () => {
    try {
      await run(process.execPath, [script]);
      assert.fail('Ожидалась ошибка процесса');
    } catch (error) {
      const result = error as Error & { code: number; stderr: string };
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Запуск:/);
    }
  });
});
