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

    /** @type {{ core?: MessageParserCore<Q> }} */
    const shared = {};
    super({
      start(controller) {
        core = shared.core = new MessageParserCore(options, {
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
    // `start` runs during construction, so the core exists here
    this._core = /** @type {MessageParserCore<Q>} */ (shared.core);
  }

  // ### `getState` gives what a next parser needs to continue this message log
  // with the input that follows: pass it as the `state` option. It is
  // undefined while a message is incomplete, after an error, and for a
  // document that is not a message log.
  /** @returns {import('../common.js').MessageParserState | undefined} */
  getState() {
    return this._core.getState();
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
