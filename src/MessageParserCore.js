// **MessageParserCore** is the push-based engine behind all message parsers.
// It feeds text to the N3.js parser, which recognizes the message delimiters
// through its `directives` option, and groups the resulting quads into messages.
import { EventEmitter } from 'events';
import { Parser, DataFactory } from 'n3';
import { resolveFormat, isMessagesVersion, baseVersion, isSupportedVersion } from './formats.js';

/** @typedef {import('@rdfjs/types').Term} BaseTerm */

// Resolves the IRI of a base declaration against the base before it, without its fragment, as N3.js does
/** @param {string} iri
 * @param {string} base */
function resolveBase(iri, base) {
  let resolved = iri;
  try {
    resolved = new URL(iri, base || undefined).href;
  }
  catch {
    // Not resolvable (e.g. no base for a relative IRI): N3.js reports that
  }
  const fragment = resolved.indexOf('#');
  return fragment < 0 ? resolved : resolved.substring(0, fragment);
}

/** @template {import('@rdfjs/types').BaseQuad} [Q=import('@rdfjs/types').Quad] */
export default class MessageParserCore {
  // `sink` receives `message(quads, index)`, `end(prefixes)`, `error(error)`
  // and optionally `quad(quad, messageIndex)`, `prefix(prefix, term)`, `version(label)`
  /**
   * @param {import('../common.js').MessageParserOptions<Q> | undefined} options
   * @param {import('./internal.js').ParserSink<Q>} sink
   */
  constructor(options, sink) {
    options = options || {};
    const format = resolveFormat(options.format);
    // A parse can continue a message log from the state of an earlier parse (see `getState`)
    const state = options.state;
    if (state && typeof state.version === 'string' && !isMessagesVersion(state.version))
      throw new Error(`A parser state continues a message log, but its version is "${state.version}".`);
    this._version = options.version ?? format.version ?? state?.version ?? undefined;
    this._sink = sink;

    /** @type {import('../common.js').MessageQuadFactory<Q>} */
    this._factory = options.factory || /** @type {import('../common.js').MessageQuadFactory<Q>} */ (DataFactory);
    this._blankNodePrefix = typeof options.blankNodePrefix === 'string' ?
      options.blankNodePrefix.replace(/^_:/, '') : undefined;
    this._blankNodeCounter = state?.blankNodes ?? 0;
    this._supportedVersions = Parser.SUPPORTED_VERSIONS;
    this._messages = options.messages === true || !!state || isMessagesVersion(this._version);
    this._index = state?.messages ?? 0;

    // What a next parse needs to continue this one: the version label in effect, the prefixes, the base IRI,
    // and whether the last message ended at the end of the input, rather than at a delimiter. In that case, the
    // delimiter that starts the continued input closes that message, and does not make an empty message.
    /** @type {string | undefined} */
    this._label = this._version;

    /** @type {Record<string, string>} */
    this._prefixes = Object.assign(Object.create(null), state?.prefixes);
    this._base = state?.base ?? options.baseIRI ?? '';
    this._baseNext = false;
    this._open = !!state?.open;
    this._restoring = false;

    /** @type {Q[] | null} */
    this._current = null;

    /** @type {Map<string, import('@rdfjs/types').BlankNode> | null} */
    this._scope = null;
    this._seenQuad = false;
    this._failed = false;
    this._finished = false;

    /** @type {import('n3').ParserOptions} */
    const n3Options = {
      format: format.name,
      factory: /** @type {import('@rdfjs/types').DataFactory} */ (/** @type {unknown} */ (this._factory)),
      // Version labels are validated here, because N3.js does not know `-messages` labels
      parseUnsupportedVersions: true,
      // N3.js reports `MESSAGE` and `@message .` between statements through `onDirective`,
      // in order with the quads, and rejects them anywhere else
      directives: ['message'],
    };
    if (this._base)
      n3Options.baseIRI = this._base;
    if (this._version !== undefined) {
      this._checkVersion(this._version, true);
      n3Options.version = baseVersion(this._version);
    }

    this._input = new EventEmitter();
    this._lineMode = format.lineMode;
    // The line of the current token, and of the last delimiter
    this._line = 0;
    this._delimiterLine = 0;
    new Parser(n3Options).parse(this._input, {
      onQuad: (error, quad, prefixes) => this._onQuad(error, /** @type {Q | null} */ (quad), prefixes),
      onPrefix: (prefix, term) => this._failed || this._prefix(prefix, term),
      onVersion: label => this._failed || this._announce(label),
      onDirective: () => this._failed || this._delimiter(),
      onToken: token => this._onToken(token),
    });

    // N3.js starts every parse without prefixes, and has no option for them: the prefixes of a parser state are
    // declared to it before the input. They are on one line that the input continues, so that the line numbers of
    // the input stay the same. N-Triples and N-Quads have no prefixes.
    const prefixes = Object.keys(this._prefixes);
    if (prefixes.length > 0 && !this._lineMode) {
      this._restoring = true;
      this._input.emit('data', prefixes.map(prefix => `PREFIX ${prefix}: <${this._prefixes[prefix]}> `).join(''));
      this._restoring = false;
    }
  }

  // ### `getState` gives what a next parser needs to continue this message log
  // with the input that follows, as JSON-serializable data: pass it as the
  // `state` option. It is undefined while a message is incomplete, after an
  // error, and for a document that is not a message log.
  /** @returns {import('../common.js').MessageParserState | undefined} */
  getState() {
    if (!this._messages || this._failed || this._current !== null)
      return undefined;
    return {
      version: this._label ?? null,
      prefixes: Object.assign({}, this._prefixes),
      ...(this._base && { base: this._base }),
      messages: this._index,
      blankNodes: this._blankNodeCounter,
      open: this._open,
    };
  }

  // ### `write` accepts the next chunk of text
  /** @param {string} text */
  write(text) {
    if (!this._failed && !this._finished && text.length > 0)
      this._input.emit('data', text);
  }

  // ### `end` signals the end of the input
  end() {
    if (!this._failed && !this._finished)
      this._input.emit('end');
  }

  // Keeps track of a declared prefix, for the parser state
  /** @param {string} prefix
   * @param {import('@rdfjs/types').NamedNode} term */
  _prefix(prefix, term) {
    this._prefixes[prefix] = term.value;
    // The prefixes of a parser state are not declarations of the input
    if (this._sink.prefix && !this._restoring)
      this._sink.prefix(prefix, term);
  }

  // Keeps track of lines; in N-Triples and N-Quads, a delimiter must be on its own line
  /** @param {{ line: number; type: string; value?: string }} token */
  _onToken(token) {
    // Keeps track of the base IRI, for the parser state: the IRI after `@base` or `BASE`, resolved against the one before
    if (this._baseNext) {
      this._baseNext = false;
      if (token.type === 'IRI')
        this._base = resolveBase(/** @type {string} */ (token.value), this._base);
    }
    if (token.type === '@base' || token.type === 'BASE')
      this._baseNext = true;
    const line = token.line, delimiter = token.type === 'MESSAGE';
    if (this._lineMode && !this._failed &&
        (delimiter ? line === this._line : line === this._delimiterLine && token.type !== 'eof'))
      this._fail(new Error(`Unexpected "MESSAGE" on line ${line}.`));
    if (delimiter)
      this._delimiterLine = line;
    this._line = line;
  }

  /** @param {Error | null} error
   * @param {Q | null} quad
   * @param {Record<string, import('@rdfjs/types').NamedNode>} [prefixes] */
  _onQuad(error, quad, prefixes) {
    if (this._failed || this._finished)
      return;
    if (error)
      this._fail(error);
    else if (quad)
      this._addQuad(quad);
    else {
      this._finished = true;
      if (this._current !== null)
        this._emitMessage(true);
      this._sink.end(prefixes);
    }
  }

  /** @param {Q} quad */
  _addQuad(quad) {
    this._seenQuad = true;
    this._open = false;
    // Blank node labels are scoped to their message
    if (this._messages)
      quad = this._scopeQuad(quad);
    if (this._current === null)
      this._current = [];
    this._current.push(quad);
    if (this._sink.quad)
      this._sink.quad(quad, this._index);
  }

  /** @param {string} label */
  _announce(label) {
    // An externally supplied version takes precedence over in-line announcements.
    const version = this._version ?? label;
    const error = this._checkVersion(version);
    if (error)
      return this._fail(error);
    if (isMessagesVersion(version) && !this._messages) {
      if (this._seenQuad)
        return this._fail(new Error(`Version "${label}" must be announced before the first statement.`));
      this._messages = true;
    }
    this._label = version;
    if (this._sink.version)
      this._sink.version(label);
  }

  // Validates a version label, and returns an error for unsupported ones
  /** @param {string} label
   * @param {boolean} [throwing] */
  _checkVersion(label, throwing) {
    if (isSupportedVersion(baseVersion(label), this._supportedVersions))
      return null;
    const error = new Error(`Detected unsupported version: "${label}"`);
    if (throwing)
      throw error;
    return error;
  }

  _delimiter() {
    if (!this._messages) {
      return this._fail(new Error(`Unexpected "MESSAGE" on line ${this._line}: the document did not announce ` +
                                  'a version with the "-messages" suffix.'));
    }
    // A delimiter that comes right after a message that ended at the end of the input before (a continued parse)
    // closes that message: it does not make an empty one
    if (this._open && this._current === null) {
      this._open = false;
      return;
    }
    this._emitMessage();
  }

  // Finalizes the current message, which is empty if no quad was seen
  /** @param {boolean} [atEnd] whether the message ends at the end of the input, rather than at a delimiter */
  _emitMessage(atEnd = false) {
    const quads = this._current || [];
    this._current = null;
    this._scope = null;
    this._open = atEnd;
    this._sink.message(quads, this._index++);
  }

  /** @param {Error} error */
  _fail(error) {
    this._failed = true;
    this._current = null;
    this._sink.error(error);
  }

  // ## Blank node scoping

  /** @param {Q} quad
   * @returns {Q} */
  _scopeQuad(quad) {
    const subject = this._scopeTerm(quad.subject);
    const predicate = this._scopeTerm(quad.predicate);
    const object = this._scopeTerm(quad.object);
    const graph = this._scopeTerm(quad.graph);
    return subject === quad.subject && predicate === quad.predicate &&
           object === quad.object && graph === quad.graph ?
      quad : this._factory.quad(subject, predicate, object, graph);
  }

  /** @template {BaseTerm} T
   * @param {T} term
   * @returns {T} */
  _scopeTerm(term) {
    if (term.termType === 'BlankNode') {
      const scope = this._scope || (this._scope = new Map());
      let scoped = scope.get(term.value);
      if (!scoped) {
        scoped = this._blankNodePrefix === undefined ? this._factory.blankNode() :
          this._factory.blankNode(`${this._blankNodePrefix}${this._blankNodeCounter++}`);
        scope.set(term.value, scoped);
      }
      return /** @type {T} */ (/** @type {unknown} */ (scoped));
    }
    return term.termType === 'Quad' ? /** @type {T} */ (/** @type {unknown} */ (
      this._scopeQuad(/** @type {Q} */ (/** @type {unknown} */ (term))))) : term;
  }
}
