// **MessageStreamParser** is a Node.js stream that turns text into RDF Messages.
//
// It consumes strings or buffers, and produces one array of quads per message,
// as soon as that message is complete.
import { Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import MessageParserCore from './MessageParserCore.js';

/** @template {import('@rdfjs/types').BaseQuad} [Q=import('@rdfjs/types').Quad] */
export default class MessageStreamParser extends Transform {
  /** @param {import('../common.js').MessageParserOptions<Q>} [options] */
  constructor(options) {
    super({ decodeStrings: false, readableObjectMode: true });
    this._decoder = new StringDecoder('utf8');

    /** @type {Error | null} */
    this._error = null;
    this._core = new MessageParserCore(options, {
      message: quads => this.push(quads),
      end: () => {},
      error: error => { this._error = this._error || error; },
      prefix: (prefix, term) => this.emit('prefix', prefix, term),
      version: label => this.emit('version', label),
    });
  }

  // ### `getState` gives what a next parser needs to continue this message log
  // with the input that follows: pass it as the `state` option. It is
  // undefined while a message is incomplete, after an error, and for a
  // document that is not a message log.
  /** @returns {import('../common.js').MessageParserState | undefined} */
  getState() {
    return this._core.getState();
  }

  /** @param {string | Buffer} chunk
   * @param {BufferEncoding} encoding
   * @param {import('node:stream').TransformCallback} done */
  _transform(chunk, encoding, done) {
    this._core.write(typeof chunk === 'string' ? chunk : this._decoder.write(chunk));
    done(this._error);
  }

  /** @param {import('node:stream').TransformCallback} done */
  _flush(done) {
    this._core.write(this._decoder.end());
    this._core.end();
    done(this._error);
  }
}
