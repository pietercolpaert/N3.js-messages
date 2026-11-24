import { render } from './util.js';
import { MessageParser, MessageStreamParser, parseMessages } from '../src/index.js';
import { MessageStreamParser as BrowserStreamParser } from '../src/browser.js';
import { Readable } from 'stream';

const PREAMBLE = 'VERSION "1.2-messages"\nPREFIX ex: <http://example.org/>\n';

// Parses input with callbacks, and gives the messages, the indexes of the quads, the prefixes it reported and its state
function parse(input, options) {
  return new Promise((resolve, reject) => {
    const parser = new MessageParser(options);
    const result = { messages: [], indexes: [], prefixes: [] };
    parser.parse(input, {
      onQuad: (error, quad, index) => error || result.indexes.push(index),
      onPrefix: prefix => result.prefixes.push(prefix),
      onMessage: (error, message) => {
        if (error)
          return reject(error);
        if (message)
          result.messages.push(message);
        else
          resolve({ ...result, state: parser.getState() });
      },
    });
  });
}

// Parses a document in two parts, the second one with the state of the first, as JSON
async function inTwoParts(first, second, options) {
  const a = await parse(first, options);
  const b = await parse(second, { ...options, state: JSON.parse(JSON.stringify(a.state)) });
  return { a, b, messages: [...a.messages, ...b.messages], indexes: [...a.indexes, ...b.indexes] };
}

describe('Parser state', () => {
  describe('continuing a message log', () => {
    const cases = [
      ['a delimiter that starts the second part (separator style)',
        `${PREAMBLE}ex:a ex:p 1 .\nMESSAGE\nex:b ex:p 2 .\n`, 'MESSAGE\nex:c ex:p 3 .\nMESSAGE\nex:d ex:p 4 .\n'],
      ['a delimiter that ends the first part (terminator style)',
        `${PREAMBLE}ex:a ex:p 1 .\nMESSAGE\nex:b ex:p 2 .\nMESSAGE\n`, 'ex:c ex:p 3 .\nMESSAGE\nex:d ex:p 4 .\n'],
      ['an empty message at the start of the second part',
        `${PREAMBLE}ex:a ex:p 1 .\n`, 'MESSAGE\nMESSAGE\nex:c ex:p 3 .\n'],
      ['blank nodes, which are scoped to their message',
        `${PREAMBLE}_:x ex:p 1 .\nMESSAGE\n_:x ex:p 2 .\n`, 'MESSAGE\n_:x ex:p 3 .\n'],
      ['prefixes declared in both parts',
        `${PREAMBLE}ex:a ex:p 1 .\n`, 'MESSAGE\nPREFIX other: <http://other.org/>\nother:c ex:p 3 .\n'],
    ];
    it.each(cases)('gives the messages of the whole document, with %s', async (_, first, second) => {
      const { messages, indexes } = await inTwoParts(first, second, { format: 'TriG', blankNodePrefix: 'b_' });
      const whole = parseMessages(first + second, { format: 'TriG', blankNodePrefix: 'b_' });
      expect(render(messages)).toEqual(render(whole));
      // Message indexes go on where the first part stopped
      const wholeIndexes = [];
      new MessageParser({ format: 'TriG' }).parse(first + second, { onQuad: (error, quad, index) => error || wholeIndexes.push(index) });
      expect(indexes).toEqual(wholeIndexes);
    });

    it('uses the prefixes of the first part in the second, without reporting them again', async () => {
      const { a, b } = await inTwoParts(`${PREAMBLE}ex:a ex:p 1 .\n`, 'MESSAGE\nex:b ex:p 2 .\n', { format: 'TriG' });
      expect(a.prefixes).toEqual(['ex']);
      expect(b.prefixes).toEqual([]);
      expect(b.messages[0][0].subject.value).toBe('http://example.org/b');
      expect(b.state.prefixes).toEqual({ ex: 'http://example.org/' });
    });

    it('continues an N-Quads log, which has no prefixes', async () => {
      const first = 'VERSION "1.2-messages"\n<http://e/a> <http://e/p> "1" .\nMESSAGE\n<http://e/b> <http://e/p> "2" <http://e/g> .\n';
      const second = 'MESSAGE\n<http://e/c> <http://e/p> "3" .\n';
      const { messages } = await inTwoParts(first, second, { format: 'N-Quads' });
      expect(render(messages)).toEqual(render(parseMessages(first + second, { format: 'N-Quads' })));
    });

    it('keeps the base IRI that the first part declared', async () => {
      for (const declaration of ['@base <http://example.org/a/> .', 'BASE <http://example.org/a/>']) {
        const { a, b } = await inTwoParts(`${PREAMBLE}${declaration}\n<x> ex:p 1 .\n`, 'MESSAGE\n<y> ex:p 2 .\n', { format: 'TriG' });
        expect(a.state.base).toBe('http://example.org/a/');
        expect(b.messages[0][0].subject.value).toBe('http://example.org/a/y');
      }
    });

    it('resolves a relative base declaration against the base before it', async () => {
      const { state } = await parse(`${PREAMBLE}BASE <http://example.org/a/>\nBASE <b/>\n<x> ex:p 1 .\n`, { format: 'TriG' });
      expect(state.base).toBe('http://example.org/a/b/');
    });

    it('keeps generated blank node labels unique across the parts', async () => {
      const { messages } = await inTwoParts(`${PREAMBLE}_:x ex:p 1 .\n`, 'MESSAGE\n_:x ex:p 2 .\n', { format: 'TriG', blankNodePrefix: 'b_' });
      expect(messages[0][0].subject.value).not.toBe(messages[1][0].subject.value);
    });

    it('stays the same when nothing follows', async () => {
      const { a, b } = await inTwoParts(`${PREAMBLE}ex:a ex:p 1 .\n`, '', { format: 'TriG' });
      expect(b.messages).toEqual([]);
      expect(b.state).toEqual(a.state);
    });

    it('reports errors in the second part with its own line numbers', async () => {
      const { state } = await parse(`${PREAMBLE}ex:a ex:p 1 .\n`, { format: 'TriG' });
      await expect(parse('MESSAGE\nex:b ex:p .\n', { format: 'TriG', state })).rejects.toThrow(/line 2/);
    });
  });

  describe('getState', () => {
    it('describes the log after a parse', async () => {
      const { state } = await parse(`${PREAMBLE}ex:a ex:p 1 .\nMESSAGE\nex:b ex:p 2 .\n`, { format: 'TriG' });
      expect(state).toEqual({ version: '1.2-messages', prefixes: { ex: 'http://example.org/' }, messages: 2, blankNodes: 0, open: true });
    });

    it('has no version when message mode was forced without one, and still continues', async () => {
      const options = { format: 'N-Triples', messages: true };
      const { a, b } = await inTwoParts('<http://e/a> <http://e/p> "1" .\n', 'MESSAGE\n<http://e/b> <http://e/p> "2" .\n', options);
      expect(a.state.version).toBeNull();
      expect(b.messages.map(message => message[0].subject.value)).toEqual(['http://e/b']);
    });

    it('is undefined for a document that is not a message log', async () => {
      const { state } = await parse('<http://e/a> <http://e/p> "1" .\n', { format: 'Turtle' });
      expect(state).toBeUndefined();
    });

    it('is undefined before a parse and after an error', async () => {
      const parser = new MessageParser({ format: 'TriG' });
      expect(parser.getState()).toBeUndefined();
      await new Promise(resolve => parser.parse(`${PREAMBLE}ex:a ex:p .\n`, error => error && resolve()));
      expect(parser.getState()).toBeUndefined();
    });

    it('is offered by the Node.js stream parser', async () => {
      const parser = new MessageStreamParser({ format: 'TriG' });
      const messages = [];
      await new Promise((resolve, reject) => {
        Readable.from([`${PREAMBLE}ex:a ex:p 1 .\n`]).pipe(parser).on('data', m => messages.push(m)).on('end', resolve).on('error', reject);
      });
      const next = new MessageStreamParser({ format: 'TriG', state: parser.getState() });
      const more = [];
      await new Promise((resolve, reject) => {
        Readable.from(['MESSAGE\nex:b ex:p 2 .\n']).pipe(next).on('data', m => more.push(m)).on('end', resolve).on('error', reject);
      });
      expect(more.map(message => message[0].subject.value)).toEqual(['http://example.org/b']);
    });

    it('is offered by the Web Streams parser', async () => {
      async function read(text, options) {
        const parser = new BrowserStreamParser(options);
        const reader = new ReadableStream({ start(c) { c.enqueue(text); c.close(); } }).pipeThrough(parser).getReader();
        const messages = [];
        for (let next = await reader.read(); !next.done; next = await reader.read())
          messages.push(next.value);
        return { messages, state: parser.getState() };
      }
      const first = await read(`${PREAMBLE}ex:a ex:p 1 .\n`, { format: 'TriG' });
      const second = await read('MESSAGE\nex:b ex:p 2 .\n', { format: 'TriG', state: first.state });
      expect(second.messages.map(message => message[0].subject.value)).toEqual(['http://example.org/b']);
      expect(second.state.messages).toBe(2);
    });
  });

  it('rejects a state of a document that is not a message log', () => {
    expect(() => new MessageParser({ state: { version: '1.2', prefixes: {}, messages: 0, blankNodes: 0, open: false } }))
      .toThrow(/continues a message log/);
  });
});
