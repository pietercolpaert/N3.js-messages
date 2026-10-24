// **MessageParser** parses RDF Message Logs (Turtle, TriG, N-Triples and N-Quads).
import { StringDecoder } from 'string_decoder';
import MessageParserCore from './MessageParserCore.js';

/** @template {import('@rdfjs/types').BaseQuad} [Q=import('@rdfjs/types').Quad] */
export default class MessageParser {
  /** @param {import('../common.js').MessageParserOptions<Q>} [options] */
  constructor(options) {
    /** @type {import('../common.js').MessageParserOptions<Q>} */
    this._options = options || {};
    // Fail early on unsupported options
    // Construction only validates options; this core never receives input.
    this._createCore(/** @type {import('./internal.js').ParserSink<Q>} */ ({}));
  }

  /** @param {import('./internal.js').ParserSink<Q>} sink */
  _createCore(sink) {
    return new MessageParserCore(this._options, sink);
  }

  // ### `parse` parses a string or a readable stream of RDF Messages.
  //
  // Without callbacks, a string is parsed synchronously into an array of
  // messages (arrays of quads), and parse errors are thrown.
  // With a callback `(error, message, prefixes)`, or an object with the
  // callbacks `onMessage(error, message, prefixes)`, `onQuad(error, quad, messageIndex)`,
  // `onPrefix(prefix, term)` and `onVersion(label)`, messages are reported as soon
  // as they are complete. The final call has `null` as message.
  /**
   * @overload
   * @param {string} input
   * @returns {Q[][]}
   */
  /**
   * @overload
   * @param {string | NodeJS.ReadableStream} input
   * @param {import('../common.js').MessageCallback<Q> | import('../common.js').MessageParseCallbacks<Q>} [callbacks]
   * @returns {void}
   */
  /**
   * @param {string | NodeJS.ReadableStream} input
   * @param {import('../common.js').MessageCallback<Q> | import('../common.js').MessageParseCallbacks<Q>} [callbacks]
   * @returns {Q[][] | undefined}
   */
  parse(input, callbacks) {
    if (typeof callbacks === 'function')
      callbacks = { onMessage: callbacks };

    /** @type {Q[][] | null} */
    const messages = callbacks ? null : [];

    /** @type {Error | null} */
    let error = null;
    callbacks = callbacks || {};

    /** @type {import('./internal.js').ParserSink<Q>} */
    const sink = {
      message: (quads, index) => callbacks.onMessage ? callbacks.onMessage(null, quads, undefined, index) : messages && messages.push(quads),
      end: prefixes => callbacks.onMessage && callbacks.onMessage(null, null, prefixes),
      error: e => {
        error = e;
        callbacks.onMessage && callbacks.onMessage(e, null);
        callbacks.onQuad && callbacks.onQuad(e);
      },
    };
    if (callbacks.onQuad)
      sink.quad = (quad, index) => callbacks.onQuad?.(null, quad, index);
    if (callbacks.onPrefix)
      sink.prefix = callbacks.onPrefix;
    if (callbacks.onVersion)
      sink.version = callbacks.onVersion;
    const core = this._createCore(sink);

    // Parse a string at once
    if (typeof input === 'string') {
      core.write(input);
      core.end();
      if (error && messages)
        throw error;
      return messages || undefined;
    }

    // Parse a stream chunk by chunk
    const decoder = new StringDecoder('utf8');
    input.on('data', chunk => core.write(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
    input.on('end', () => {
      core.write(decoder.end());
      core.end();
    });
    input.on('error', e => sink.error(e));
    return undefined;
  }
}

/**
 * @template {import('@rdfjs/types').BaseQuad} [Q=import('@rdfjs/types').Quad]
 * @param {string} input
 * @param {import('../common.js').MessageParserOptions<Q>} [options]
 */
// ### `parseMessages` synchronously parses a string into an array of messages
export function parseMessages(input, options) {
  return new MessageParser(options).parse(input);
}
