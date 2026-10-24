// Runtime-only validation: no test runner/build tools are required by this process.
const assert = require('node:assert/strict');

(async () => {
  const cjs = require('n3.js-messages');
  const esm = await import('n3.js-messages');
  const browser = await import('n3.js-messages/browser');
  const input = 'VERSION "1.2-messages"\n<a> <b> "☃" .\nMESSAGE\n<a> <b> <c> .\n';
  for (const library of [cjs, esm, browser]) {
    const messages = library.parseMessages(input);
    assert.equal(messages.length, 2);
    assert.equal(library.parseMessages(library.writeMessages(messages)).length, 2);
  }
  const { Readable } = require('node:stream');
  const stream = Readable.from([input]).pipe(new cjs.MessageStreamParser());
  const output = [];
  for await (const message of stream) output.push(message);
  assert.equal(output.length, 2);
  console.log(`Node ${process.versions.node}: packed CJS, ESM, browser entry and Node streams OK`);
})().catch(error => { console.error(error); process.exitCode = 1; });
