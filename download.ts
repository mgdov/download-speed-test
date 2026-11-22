import { performance } from 'node:perf_hooks';

async function main(): Promise<void> {
  const address = process.argv[2];
  if (!address || process.argv.length !== 3) {
    throw new Error('Запуск: npm start -- "https://site.ru/file.jpg"');
  }

  const url = new URL(address);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Нужен адрес с http:// или https://');
  }

  const requestCount = 10;
  let totalBytes = 0;
  let totalSeconds = 0;

  for (let i = 1; i <= requestCount; i++) {
    const started = performance.now();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Запрос ${i}: HTTP ${response.status}`);
    }

    if (response.body) {
      for await (const chunk of response.body) {
        totalBytes += chunk.byteLength;
      }
    }
    totalSeconds += (performance.now() - started) / 1000;
  }

  const averageSeconds = totalSeconds / requestCount;
  const speedMB = totalBytes / totalSeconds / 1_000_000;
  const speedMbit = speedMB * 8;

  console.log(`Запросов: ${requestCount}`);
  console.log(`Скачано: ${totalBytes} байт`);
  console.log(`Общее время: ${totalSeconds.toFixed(6)} с`);
  console.log(`Среднее время: ${averageSeconds.toFixed(6)} с`);
  console.log(`Скорость: ${speedMB.toFixed(3)} MB/s`);
  console.log(`Скорость: ${speedMbit.toFixed(3)} Mbit/s`);
}

main().catch((error: unknown) => {
  console.error('Ошибка:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
