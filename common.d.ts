import type * as RDF from '@rdfjs/types';

export type MessageFormat =
  | 'Turtle' | 'TriG' | 'N-Triples' | 'N-Quads'
  | (string & {});

/** One RDF message: the quads between two message delimiters. */
export type Message<Q extends RDF.BaseQuad = RDF.Quad> = Q[];

/**
 * The part of an RDF/JS DataFactory that is used for parsing; any `RDF.DataFactory<Q>` fits.
 * The quads that the factory creates determine the quads that are parsed.
 */
export interface MessageQuadFactory<Q extends RDF.BaseQuad = RDF.Quad>
  extends Pick<RDF.DataFactory<RDF.Quad, any>, 'namedNode' | 'blankNode' | 'literal' | 'variable' | 'defaultGraph'> {
  quad(subject: Q['subject'], predicate: Q['predicate'], object: Q['object'], graph?: Q['graph']): Q;
}

export interface MessageParserOptions<Q extends RDF.BaseQuad = RDF.Quad> {
  /** Syntax name or media type, case-insensitive. Defaults to `TriG`. */
  format?: MessageFormat;
  baseIRI?: string;
  /** Data factory used to create terms and quads. */
  factory?: MessageQuadFactory<Q>;
  /** Prefix for generated blank node labels, e.g. `b0_`. */
  blankNodePrefix?: string;
  /** RDF version label, e.g. `1.2-messages`; a `-messages` suffix forces message mode. */
  version?: string;
  /** Force message mode even without a `-messages` version declaration. */
  messages?: boolean;
}

export type MessageCallback<Q extends RDF.BaseQuad = RDF.Quad> = (
  error: Error | null,
  message: Q[] | null,
  prefixes?: { [prefix: string]: RDF.NamedNode },
  index?: number,
) => void;

export interface MessageParseCallbacks<Q extends RDF.BaseQuad = RDF.Quad> {
  onMessage?: MessageCallback<Q>;
  onQuad?: (error: Error | null, quad?: Q, messageIndex?: number) => void;
  onPrefix?: (prefix: string, term: RDF.NamedNode) => void;
  onVersion?: (version: string) => void;
}

export interface MessageWriterOptions {
  /** Syntax name or media type, case-insensitive. Defaults to `TriG`. */
  format?: MessageFormat;
  /** Prefixes that are declared up front. */
  prefixes?: { [prefix: string]: RDF.NamedNode | string };
  baseIRI?: string;
  writeBase?: boolean;
  lists?: { [listHead: string]: RDF.Term[] };
  /** RDF version label announced in the output. Defaults to `1.2-messages`. */
  version?: string;
  /** Whether to end the output stream on `end()`. Defaults to `true`. */
  end?: boolean;
}

export interface MessageOutputStream {
  write(chunk: string, encoding?: string, callback?: (error?: Error | null) => void): unknown;
  end(callback?: (error?: Error | null) => void): unknown;
}

export class MessageWriter {
  constructor(options?: MessageWriterOptions);
  constructor(outputStream?: MessageOutputStream | null, options?: MessageWriterOptions);
  addMessage(quads: RDF.BaseQuad[], done: (error: Error | null) => void): void;
  addMessage(quads: RDF.BaseQuad[]): Promise<void>;
  /** Opens a message; optional, as `addQuad` opens one implicitly. */
  beginMessage(done: (error: Error | null) => void): void;
  beginMessage(): Promise<void>;
  /** Writes a quad right away. With a 0-based `messageIndex`, a change of index ends the message and writes empty messages for gaps; a lower index is an error. */
  addQuad(quad: RDF.BaseQuad, messageIndex: number | undefined, done: (error: Error | null) => void): void;
  addQuad(quad: RDF.BaseQuad, done: (error: Error | null) => void): void;
  addQuad(quad: RDF.BaseQuad, messageIndex?: number): Promise<void>;
  /** Ends the open message (writes an empty message if none is open). */
  endMessage(done: (error: Error | null) => void): void;
  endMessage(): Promise<void>;
  addPrefix(prefix: string, iri: RDF.NamedNode | string, done: (error: Error | null) => void): void;
  addPrefix(prefix: string, iri: RDF.NamedNode | string): Promise<void>;
  /** Without an output stream, the result is the written string. */
  end(done: (error: Error | null, result?: string) => void): void;
  end(): Promise<string>;
}

export function writeMessages(messages: Iterable<RDF.BaseQuad[]>, options?: MessageWriterOptions): string;

