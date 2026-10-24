// Same-run comparisons with a Git baseline. Uses git archive so .git and the checkout stay untouched.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { isomorphic } from 'rdf-isomorphic';
import { messageLog } from './data.js';

if (!global.gc) {
  const result = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const ref = process.env.PERF_BASE_REF || 'HEAD';
const samples = Number(process.env.PERF_SAMPLES || 5);
const threshold = Number(process.env.PERF_THRESHOLD || 20);
assert(Number.isSafeInteger(samples) && samples > 0, 'PERF_SAMPLES must be a positive integer');
assert(Number.isFinite(threshold) && threshold > 0, 'PERF_THRESHOLD must be positive');
const commit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const tmp = mkdtempSync(path.join(os.tmpdir(), 'n3-messages-perf-'));
try {
  const archive = execFileSync('git', ['archive', commit, 'src'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', tmp], { input: archive });
  writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  const baseline = await import(pathToFileURL(path.join(tmp, 'src/index.js')).href);
  const current = await import('../src/index.js');
  const input = messageLog(100, 100).text;
  const expected = current.parseMessages(input);
  const buffer = Buffer.from(input);
  const results = [];
  function equivalent(actual) {
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < actual.length; i++) assert(isomorphic(actual[i], expected[i]));
  }
  async function stream(library, size) {
    const chunks = (function* () {
      for (let i = 0; i < buffer.length; i += size) yield buffer.subarray(i, i + size);
    })();
    const messages = [];
    for await (const message of Readable.from(chunks).pipe(new library.MessageStreamParser())) messages.push(message);
    return messages;
  }
  const scenarios = [
    ['parseMessages', library => library.parseMessages(input), equivalent],
    ['stream 64 KiB', library => stream(library, 64 * 1024), equivalent],
    ['stream 16 bytes', library => stream(library, 16), equivalent],
    ['writeMessages', library => library.writeMessages(expected), text => equivalent(current.parseMessages(text))],
  ];
  for (const [name, run, validate] of scenarios) {
    const entries = [{ label: 'baseline', library: baseline, times: [] }, { label: 'current', library: current, times: [] }];
    for (const entry of entries)
      for (let i = 0; i < 2; i++) validate(await run(entry.library));
    for (let sample = 0; sample < samples; sample++) {
      for (let offset = 0; offset < entries.length; offset++) {
        const entry = entries[(sample + offset) % entries.length];
        global.gc();
        const start = process.hrtime.bigint();
        const output = await run(entry.library);
        entry.times.push(Number(process.hrtime.bigint() - start) / 1e6);
        validate(output);
      }
    }
    function median(values) {
      const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    const baselineMs = median(entries[0].times), currentMs = median(entries[1].times);
    const slowdown = (currentMs / baselineMs - 1) * 100;
    results.push({ name, baselineMs, currentMs, slowdownPercent: slowdown,
      baselineSamplesMs: entries[0].times, currentSamplesMs: entries[1].times });
    console.log(`${name}: ${slowdown.toFixed(1)}% time change against ${commit.slice(0, 8)}`);
    if (slowdown > threshold) {
      const message = `${name} took ${slowdown.toFixed(1)}% longer than baseline (threshold ${threshold}%)`;
      console.warn(process.env.GITHUB_ACTIONS ? `::warning title=Performance regression::${message}` : `WARNING: ${message}`);
    }
  }
  mkdirSync(path.join(root, '.perf-results'), { recursive: true });
  writeFileSync(path.join(root, '.perf-results/regression.json'), `${JSON.stringify({
    baseline: commit, node: process.version, cpu: os.cpus()[0].model, samples, threshold, results,
  }, null, 2)}\n`);
}
finally { rmSync(tmp, { recursive: true, force: true }); }
