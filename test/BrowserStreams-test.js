import { MessageStreamParser, MessageStreamWriter, parseMessages, writeMessages } from '../src/browser.js';

const INPUT = 'VERSION "1.2-messages"\nPREFIX ex: <http://example.org/>\n_:b ex:p "☃😀" .\nMESSAGE\nMESSAGE\n_:b ex:p "end" .\n';
async function collect(stream) {
  const reader = stream.getReader();
  const values = [];
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

describe('Browser Web Streams', () => {
  it('parses strings, split UTF-8 bytes, ArrayBuffers and views with events', async () => {
    const prefixes = [], versions = [];
    const bytes = new TextEncoder().encode(INPUT);
    const chunks = [...bytes].map((byte, index) => {
      const data = Uint8Array.of(byte);
      return index % 2 ? data.buffer : new DataView(data.buffer);
    });
    const messages = await collect(source(chunks).pipeThrough(new MessageStreamParser({
      onPrefix: (prefix, node) => prefixes.push([prefix, node.value]),
      onVersion: version => versions.push(version),
    })));
    expect(messages.map(message => message.length)).toEqual([1, 0, 1]);
    expect(messages[0][0].object.value).toBe('☃😀');
    expect(messages[0][0].subject.equals(messages[2][0].subject)).toBe(false);
    expect(prefixes).toEqual([['ex', 'http://example.org/']]);
    expect(versions).toEqual(['1.2-messages']);
    expect((await collect(source([...INPUT]).pipeThrough(new MessageStreamParser()))).map(message => message.length)).toEqual([1, 0, 1]);
  });

  it.each(['Turtle', 'TriG', 'N-Triples', 'N-Quads'])('round trips %s with native streams', async format => {
    const messages = parseMessages(INPUT);
    const text = (await collect(source(messages).pipeThrough(new MessageStreamWriter({ format })))).join('');
    const back = await collect(source([text]).pipeThrough(new MessageStreamParser({ format })));
    expect(back.map(message => message.length)).toEqual([1, 0, 1]);
    expect(back[0][0].object.value).toBe('☃😀');
    expect(parseMessages(writeMessages(messages, { format }), { format })).toHaveLength(3);
  });

  it('writes indexed quads and fills empty messages', async () => {
    const quad = parseMessages('<a> <b> <c> .')[0][0];
    const text = (await collect(source([{ quad, messageIndex: 2 }, { quad }]).pipeThrough(new MessageStreamWriter()))).join('');
    expect(parseMessages(text).map(message => message.length)).toEqual([0, 0, 2]);
  });

  it('flushes an incomplete UTF-8 sequence with replacement', async () => {
    const bytes = new TextEncoder().encode('<a> <b> "');
    await expect(collect(source([bytes, Uint8Array.of(0xe2)]).pipeThrough(new MessageStreamParser()))).rejects.toThrow();
  });

  it('rejects parse errors during transform and flush', async () => {
    await expect(collect(source(['MESSAGE\n']).pipeThrough(new MessageStreamParser()))).rejects.toThrow();
    await expect(collect(source(['<a> <b>']).pipeThrough(new MessageStreamParser()))).rejects.toThrow();
    expect(() => new MessageStreamParser({ format: 'RDF/XML' })).toThrow();
  });

  it('rejects invalid writer options and indexed quads', async () => {
    expect(() => new MessageStreamWriter({ version: '9-messages' })).toThrow();
    const quad = parseMessages('<a> <b> <c> .')[0][0];
    await expect(collect(source([{ quad, messageIndex: -1 }]).pipeThrough(new MessageStreamWriter()))).rejects.toThrow();
  });

  it('propagates source errors and downstream cancellation', async () => {
    const failure = new Error('source failed');
    await expect(collect(new ReadableStream({ start(controller) { controller.error(failure); } })
      .pipeThrough(new MessageStreamParser()))).rejects.toBe(failure);
    let cancelled;
    const upstream = new ReadableStream({ cancel(reason) { cancelled = reason; } });
    const reader = upstream.pipeThrough(new MessageStreamParser()).getReader();
    await reader.cancel('stop');
    // Pipe cancellation propagates asynchronously.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancelled).toBe('stop');
  });

  it('applies backpressure until a reader consumes a message', async () => {
    const parser = new MessageStreamParser();
    const writer = parser.writable.getWriter();
    let completed = false;
    const pending = writer.write(INPUT).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    const reading = collect(parser.readable);
    await pending;
    await writer.close();
    expect(await reading).toHaveLength(3);
  });
});
