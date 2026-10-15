// **MessageStreamWriter** is a Node.js stream that serializes RDF Messages.
//
// It consumes messages (arrays of quads), or `{ quad, messageIndex }` objects, and produces text.
import { Transform } from 'stream';
import MessageWriter from './MessageWriter.js';

export default class MessageStreamWriter extends Transform {
  constructor(options) {
    super({ writableObjectMode: true, encoding: 'utf8' });
    // Writing into this stream never blocks, and output is pushed synchronously
    const output = { write: (chunk, encoding, done) => (this.push(chunk), done && done()) };
    this._writer = new MessageWriter(output, Object.assign({}, options, { end: false }));
  }

  _transform(message, encoding, done) {
    // A message (array of quads), or a quad of a message: `{ quad, messageIndex }`
    if (Array.isArray(message)) this._writer.addMessage(message, done);
    else this._writer.addQuad(message.quad, message.messageIndex, done);
  }

  _flush(done) {
    this._writer.end(done);
  }
}
