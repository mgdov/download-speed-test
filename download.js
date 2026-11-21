#!/usr/bin/env node
'use strict';

const { performance } = require('node:perf_hooks');

const REQUEST_COUNT = 10;

function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null;
  if (args.length !== 1 && !(args.length === 3 && args[1] === '--timeout')) {
    throw new Error('Usage: node download.js <http(s)-url> [--timeout <seconds>]');
  }
  const url = new URL(args[0]);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }
  const timeout = args.length === 3 ? Number(args[2]) : 30;
  const timeoutMs = Math.ceil(timeout * 1000);
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs > 2147483647) {
    throw new Error('Timeout must be positive and no more than 2147483 seconds');
  }
  return { url: url.href, timeoutMs };
}

async function download(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let bytes = 0;
  const started = performance.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) {
      if (response.body) await response.body.cancel();
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (response.body) {
      for await (const chunk of response.body) bytes += chunk.byteLength;
    }
    return { bytes, seconds: (performance.now() - started) / 1000 };
  } finally {
    clearTimeout(timer);
  }
}

async function measure(url, timeoutMs = 30000) {
  let totalBytes = 0;
  let totalSeconds = 0;
  for (let i = 1; i <= REQUEST_COUNT; i++) {
    try {
      // Await the entire body before starting the next request.
      const result = await download(url, timeoutMs);
      totalBytes += result.bytes;
      totalSeconds += result.seconds;
    } catch (error) {
      throw new Error(`Request ${i}/${REQUEST_COUNT} failed: ${error.message}`, { cause: error });
    }
  }
  if (totalSeconds <= 0) throw new Error('Measured duration must be greater than zero');
  return { totalBytes, totalSeconds };
}

function formatResult({ totalBytes, totalSeconds }) {
  return [
    `Completed requests: ${REQUEST_COUNT}`,
    `Total downloaded: ${totalBytes} bytes (${(totalBytes / 1e6).toFixed(3)} MB)`,
    `Total request time: ${totalSeconds.toFixed(6)} s`,
    `Average request time: ${(totalSeconds / REQUEST_COUNT).toFixed(6)} s`,
    `Download speed: ${(totalBytes / totalSeconds / 1e6).toFixed(3)} MB/s`,
    `Download speed: ${(totalBytes * 8 / totalSeconds / 1e6).toFixed(3)} Mbit/s`,
  ].join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (!options) {
    console.log('Usage: node download.js <http(s)-url> [--timeout <seconds>]\nNode.js 22+, no dependencies. Default timeout: 30 seconds per complete request.');
    return;
  }
  try {
    console.log(formatResult(await measure(options.url, options.timeoutMs)));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { parseArgs, download, measure, formatResult };
