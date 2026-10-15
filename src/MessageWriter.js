// **MessageWriter** writes RDF Message Logs (Turtle, TriG, N-Triples and N-Quads).
//
// One N3.js writer writes the whole log: its `version` option announces the log,
// and after each message, `_endStatement` finishes the pending statement (and graph block)
// before a delimiter is written (`MESSAGE` in line formats, `@message .` in Turtle and TriG).
// That way, consumers receive a message as soon as it is written, no serialization state
// (current graph, subject, predicate) leaks from one message into the next, and trailing
// empty messages survive a round trip (a delimiter before the end of the input does not create a message).
import { Writer } from 'n3';
import { resolveFormat, isMessagesVersion, baseVersion, isSupportedVersion } from './formats.js';

class LogWriter extends Writer {
  // ### `addDelimiter` ends the current message
  addDelimiter() {
    this._endStatement();
    this._write(this._lineMode ? 'MESSAGE\n' : '@message .\n');
  }
}

export default class MessageWriter {
  // `outputStream` is optional: without it, `end` returns the output as a string
  constructor(outputStream, options) {
    if (outputStream && typeof outputStream.write !== 'function')
      options = outputStream, outputStream = null;
    options = options || {};
    this._format = resolveFormat(options.format);
    this._options = options;
    this._version = options.version === undefined ? '1.2-messages' : options.version;
    if (!isMessagesVersion(this._version) || !isSupportedVersion(baseVersion(this._version)))
      throw new TypeError(`Unsupported RDF Messages version: "${this._version}"`);

    this._output = '';
    this._stream = outputStream;
    this._endStream = !outputStream || options.end !== false;
    this._pending = 0;
    this._waiting = [];
    this._error = null;
    this._started = false;
    this._ended = false;
    this._open = false;
    this._count = 0; // messages begun so far: the index of the next message
    this._declared = Object.assign({}, options.prefixes);
    this._newPrefixes = {};
    // The N3.js writer writes to this sink, which it never ends
    this._sink = { write: (chunk, encoding, done) => this._write(chunk, done) };
    this._writer = null;
  }

  // ### `addMessage` writes the quads of one message, followed by a delimiter.
  // The callback (or returned promise) completes once the output is flushed.
  addMessage(quads, done) {
    return this._complete(done, () => {
      if (this._open) throw new Error('A message is already open');
      this._begin();
      for (const quad of quads || []) this._add(quad);
      this._close();
    });
  }

  // ### `beginMessage` opens a message. It is optional: the first `addQuad` opens one implicitly.
  beginMessage(done) {
    return this._complete(done, () => {
      if (this._open) throw new Error('A message is already open');
      this._begin();
    });
  }

  // ### `addQuad` writes a quad into the open message right away (a message is opened if there is none).
  // With a `messageIndex` (0-based), a change of index ends the current message and writes the empty
  // messages in between, as rdf-writer-ts does; a lower index than the current one is an error.
  addQuad(quad, messageIndex, done) {
    if (typeof messageIndex === 'function') done = messageIndex, messageIndex = undefined;
    return this._complete(done, () => {
      if (messageIndex !== undefined && messageIndex !== null) this._moveTo(messageIndex);
      else if (!this._open) this._begin();
      this._add(quad);
    });
  }

  // ### `endMessage` ends the open message with a delimiter. Without an open message, it writes an empty one.
  endMessage(done) {
    return this._complete(done, () => {
      if (!this._open) this._begin();
      this._close();
    });
  }

  // ### `addPrefix` declares a prefix, which is written before the next message
  // and stays in effect for all messages after it
  addPrefix(prefix, iri, done) {
    return this._complete(done, () => {
      if (!this._format.lineMode && this._declared[prefix] !== (iri.value || iri))
        this._newPrefixes[prefix] = iri.value || iri;
    });
  }

  // ### `end` ends the log and, unless disabled, the output stream.
  // The callback receives the output as a string if no output stream was given.
  end(done) {
    // Ending twice is harmless
    if (this._ended)
      return typeof done === 'function' ? done(null) : Promise.resolve();
    this._start();
    if (this._open)
      this._close();
    if (typeof done === 'function')
      return this._finish(done);
    return new Promise((resolve, reject) => this._finish((error, result) => error ? reject(error) : resolve(result)));
  }

  // ## Private methods

  // Runs an action and reports completion with a callback or a promise
  _complete(done, action) {
    if (this._ended)
      this._error = this._error || new Error('Cannot write after end');
    else
      try {
        action();
      }
      catch (error) {
        this._error = this._error || error;
      }
    if (typeof done === 'function')
      return this._whenFlushed(done);
    return new Promise((resolve, reject) => this._whenFlushed(error => error ? reject(error) : resolve()));
  }

  // Ends the output once all queued writes were accepted
  _finish(callback) {
    this._ended = true;
    this._whenFlushed(error => this._endOutput(error, callback));
  }

  _endOutput(error, callback) {
    if (error || !this._endStream)
      return callback(error);
    if (!this._stream)
      return callback(null, this._output);
    try {
      this._stream.end(endError => callback(endError));
    }
    catch (endError) {
      callback(endError);
    }
  }

  // Calls back once all queued writes were accepted by the output
  _whenFlushed(done) {
    if (this._pending === 0)
      this._settle(done);
    else
      this._waiting.push(done);
  }

  _settle(done) {
    const error = this._error;
    this._error = null;
    done(error || null);
  }

  _write(chunk, done) {
    if (!this._stream) {
      this._output += chunk;
      return done && done();
    }
    this._pending++;
    try {
      this._stream.write(chunk, 'utf8', error => this._written(error, done));
    }
    catch (error) {
      this._written(error, done);
    }
  }

  // Registers that the output accepted a write, and wakes up those waiting for the output
  _written(error, done) {
    this._pending--;
    this._error = this._error || error || null;
    done && done(error);
    if (this._pending === 0)
      this._waiting.splice(0).forEach(callback => this._settle(callback));
  }

  // Announces the RDF Messages version, which makes parsers expect delimiters,
  // and declares the base and prefixes, which stay in effect for all messages
  _start() {
    if (!this._started) {
      this._started = true;
      const options = this._options;
      this._writer = new LogWriter(this._sink, {
        format: this._format.name,
        end: false,
        version: this._version,
        baseIRI: options.baseIRI,
        writeBase: options.writeBase,
        prefixes: this._declared,
      });
    }
  }

  // Opens a message: declares the prefixes that were added since the previous one
  _begin() {
    this._start();
    const writer = this._writer;
    for (const prefix of Object.keys(this._newPrefixes)) {
      writer.addPrefix(prefix, this._newPrefixes[prefix]);
      this._declared[prefix] = this._newPrefixes[prefix];
    }
    this._newPrefixes = {};
    this._open = true;
    this._count++;
  }
  _add(quad) {
    const record = error => error && (this._error = this._error || error);
    this._writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph, record);
  }
  _close() {
    this._open = false;
    this._writer.addDelimiter();
  }

  // Makes message `index` the open message, writing empty messages for the gap
  _moveTo(index) {
    const current = this._count - 1;
    if (!Number.isInteger(index) || index < 0) throw new RangeError(`Invalid message index: ${index}`);
    if (this._open && index === current) return;
    if (index <= current) throw new RangeError(`Message index ${index} is lower than the current message index ${current}`);
    if (this._open) this._close();
    while (this._count < index) {
      this._begin();
      this._close();
    }
    this._begin();
  }
}

// ### `writeMessages` synchronously serializes an array of messages to a string
export function writeMessages(messages, options) {
  const writer = new MessageWriter(options);
  const errors = [];
  let output;
  function collect(error) {
    if (error)
      errors.push(error);
  }
  for (const message of messages)
    writer.addMessage(message, collect);
  writer.end((error, result) => (collect(error), output = result));
  if (errors.length > 0)
    throw errors[0];
  return output;
}
