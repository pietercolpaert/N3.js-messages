import MessageParserCore from './MessageParserCore.js';
import MessageWriter from './MessageWriter.js';

export { default as MessageParser, parseMessages } from './MessageParser.js';
export { default as MessageWriter, writeMessages } from './MessageWriter.js';

/**
 * A Web Streams parser; strings and UTF-8 bytes can be piped directly from fetch.
 * @template {import('@rdfjs/types').BaseQuad} [Q=import('@rdfjs/types').Quad]
 * @extends {TransformStream<import('../browser.js').MessageChunk, Q[]>}
 */
export class MessageStreamParser extends TransformStream {
  /** @param {import('../browser.js').BrowserParserOptions<Q>} [options] */
  constructor(options = {}) {
    const decoder = new TextDecoder();

    /** @type {MessageParserCore<Q>} */
    let core;
    super({
      start(controller) {
        core = new MessageParserCore(options, {
          message: quads => controller.enqueue(quads),
          end: () => {},
          error: error => { throw error; },
          prefix: options.onPrefix,
          version: options.onVersion,
        });
      },
      transform(chunk) {
        core.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
      },
      flush() {
        core.write(decoder.decode());
        core.end();
      },
    });
  }
}

/** A Web Streams writer; accepts messages or individual indexed quads.
 * @extends {TransformStream<import('../browser.js').MessageWriterInput, string>} */
export class MessageStreamWriter extends TransformStream {
  /** @param {import('../common.js').MessageWriterOptions} [options] */
  constructor(options) {
    /** @type {MessageWriter} */
    let writer;
    super({
      start(controller) {
        /** @type {Pick<import('./internal.js').Output, 'write'>} */
        const output = { write: (chunk, encoding, done) => { controller.enqueue(chunk); done(); } };
        writer = new MessageWriter(output, { ...options, end: false });
      },
      transform(message) {
        return Array.isArray(message) ? writer.addMessage(message) : writer.addQuad(message.quad, message.messageIndex);
      },
      flush() {
        return writer.end().then(() => {});
      },
    });
  }
}
