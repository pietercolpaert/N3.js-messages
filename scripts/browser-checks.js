// Runs inside a browser against each packed bundle, with no Node globals.
export async function run(lib) {
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  async function collect(stream) {
    const reader = stream.getReader(), values = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return values;
        values.push(value);
      }
    }
    finally { reader.releaseLock(); }
  }
  function source(chunks) {
    return new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    } });
  }
  assert(typeof globalThis.Buffer === 'undefined' && typeof globalThis.process === 'undefined' &&
    typeof globalThis.require === 'undefined', 'Browser checks must run without Node globals');
  const input = 'VERSION "1.2-messages"\nPREFIX ex: <http://example.org/>\n_:b ex:p "☃😀" .\nMESSAGE\nMESSAGE\n_:b ex:p "end" .\n';
  const messages = lib.parseMessages(input);
  assert(messages.length === 3 && messages[1].length === 0, 'Synchronous message boundaries');
  let callbackCount = 0;
  new lib.MessageParser().parse(input, (error, message) => {
    assert(!error, 'String callback parse error');
    if (message) callbackCount++;
  });
  assert(callbackCount === 3, 'Callback parsing');
  for (const format of ['Turtle', 'TriG', 'N-Triples', 'N-Quads']) {
    const text = lib.writeMessages(messages, { format });
    const bytes = new TextEncoder().encode(text);
    const chunks = Array.from(bytes, (byte, i) => {
      const data = Uint8Array.of(byte);
      return i % 2 ? data.buffer : new DataView(data.buffer);
    });
    const versions = [];
    const result = await collect(source(chunks).pipeThrough(new lib.MessageStreamParser({
      format, onVersion: version => versions.push(version),
    })));
    assert(result.length === 3 && result[1].length === 0, `${format}: streamed boundaries`);
    assert(result[0][0].object.value === '☃😀', `${format}: split UTF-8 decoding`);
    assert(result[0][0].subject.value !== result[2][0].subject.value, `${format}: blank node scope`);
    assert(versions[0] === '1.2-messages', `${format}: version callback`);
    const encoded = await collect(source(messages).pipeThrough(new lib.MessageStreamWriter({ format })).pipeThrough(new TextEncoderStream()));
    assert((await collect(source(encoded).pipeThrough(new lib.MessageStreamParser({ format })))).length === 3, `${format}: stream writer round trip`);
  }
  const prefixes = [];
  await collect(source([input]).pipeThrough(new lib.MessageStreamParser({ onPrefix: prefix => prefixes.push(prefix) })));
  assert(prefixes[0] === 'ex', 'Prefix callback');
  for (const bad of ['MESSAGE\n', '<a> <b>']) {
    let rejected = false;
    try { await collect(source([bad]).pipeThrough(new lib.MessageStreamParser())); }
    catch { rejected = true; }
    assert(rejected, 'Invalid input must reject the readable side');
  }
  const writer = new lib.MessageWriter({ format: 'N-Quads' });
  await writer.addMessage(messages[0]);
  assert(lib.parseMessages(await writer.end(), { format: 'N-Quads' }).length === 1, 'Promise writer');
  const quad = messages[0][0];
  const indexedText = (await collect(source([{ quad, messageIndex: 2 }, { quad }])
    .pipeThrough(new lib.MessageStreamWriter()))).join('');
  const indexed = lib.parseMessages(indexedText);
  assert(indexed.length === 3 && indexed[0].length === 0 && indexed[2].length === 2, 'Indexed writer and empty message gaps');
  const failure = new Error('source failure');
  let received;
  try {
    await collect(new ReadableStream({ start(controller) { controller.error(failure); } })
      .pipeThrough(new lib.MessageStreamParser()));
  }
  catch (error) { received = error; }
  assert(received === failure, 'Source errors propagate');
  let cancelled;
  const upstream = new ReadableStream({ cancel(reason) { cancelled = reason; } });
  await upstream.pipeThrough(new lib.MessageStreamParser()).getReader().cancel('stop');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(cancelled === 'stop', 'Downstream cancellation propagates');
  const transform = new lib.MessageStreamParser();
  const sink = transform.writable.getWriter();
  let completed = false;
  const pending = sink.write(input).then(() => { completed = true; });
  await Promise.resolve();
  assert(!completed, 'A write waits until the readable side is consumed');
  const reading = collect(transform.readable);
  await pending;
  await sink.close();
  assert((await reading).length === 3, 'Backpressure round trip');
}

