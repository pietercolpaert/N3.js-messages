// Exercise the published files in real browsers, without Node globals or bundler polyfills.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'n3-messages-browser-'));
let bundlerOutput;
const server = createServer((request, response) => {
  const routes = {
    '/': ['text/html', '<!doctype html><title>Browser package test</title>'],
    '/bundler.js': ['text/javascript', () => bundlerOutput],
    '/checks.js': ['text/javascript', readFileSync(new URL('./browser-checks.js', import.meta.url))],
  };
  for (const file of ['index.js', 'index.global.js'])
    routes[`/${file}`] = ['text/javascript', () => readFileSync(path.join(tmp, 'package/browser', file))];
  const route = routes[request.url];
  if (!route) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', route[0]);
  response.end(typeof route[1] === 'function' ? route[1]() : route[1]);
});
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const output = execFileSync(npm, ['pack', '--json', '--pack-destination', tmp], { cwd: root, encoding: 'utf8' });
  const packed = JSON.parse(output.slice(output.indexOf('[')))[0];
  execFileSync('tar', ['-xzf', path.join(tmp, packed.filename), '-C', tmp]);
  const bundle = await build({ stdin: { contents: "export * from 'n3.js-messages';", resolveDir: path.join(tmp, 'package') },
    bundle: true, platform: 'browser', format: 'esm', write: false });
  bundlerOutput = bundle.outputFiles[0].text;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const name of (process.env.BROWSER_ENGINES || 'chromium').split(',')) {
    const engine = { chromium, firefox, webkit }[name];
    assert(engine, `Unknown browser: ${name}`);
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.goto(url);
      await page.evaluate(async () => {
        const checksUrl = `${location.origin}/checks.js`;
        const { run } = await import(checksUrl);
        await run(await import(`${location.origin}/index.js`));
        await run(await import(`${location.origin}/bundler.js`));
      });
      await page.addScriptTag({ url: `${url}/index.global.js` });
      await page.evaluate(async () => {
        const checksUrl = `${location.origin}/checks.js`;
        const { run } = await import(checksUrl);
        await run(globalThis.N3Messages);
      });
      // The ESM bundle must also run in a worker, without a DOM.
      await page.evaluate(() => new Promise((resolve, reject) => {
        const blob = new Blob([`import * as library from '${location.origin}/index.js';
import { run } from '${location.origin}/checks.js';
await run(library);
postMessage(true);`], { type: 'text/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl, { type: 'module' });
        const finish = () => { worker.terminate(); URL.revokeObjectURL(workerUrl); };
        worker.onmessage = event => { finish(); event.data === true ? resolve() : reject(new Error('Worker parsing failed')); };
        worker.onerror = event => { finish(); reject(new Error(event.message)); };
      }));
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}: packed ESM, browser export resolution, global bundle, Web Streams and module worker`);
    }
    finally { await browser.close(); }
  }
}
finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
}
