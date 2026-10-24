// Type definitions for n3.js-messages
import * as RDF from '@rdfjs/types';
import { Transform } from 'stream';

export * from './common.js';
import type { MessageParserOptions, MessageCallback, MessageParseCallbacks, MessageWriterOptions } from './common.js';

export class MessageParser<Q extends RDF.BaseQuad = RDF.Quad> {
  constructor(options?: MessageParserOptions<Q>);
  /** Synchronously parses a string; throws on syntax errors. */
  parse(input: string): Q[][];
  /** Parses a string or stream, reporting messages through a callback. */
  parse(input: string | NodeJS.ReadableStream, callback: MessageCallback<Q>): void;
  /** Parses a string or stream, reporting through object callbacks. */
  parse(input: string | NodeJS.ReadableStream, callbacks: MessageParseCallbacks<Q>): void;
  /** Parses a stream without callbacks (reports nothing). */
  parse(input: NodeJS.ReadableStream): void;
}

export function parseMessages<Q extends RDF.BaseQuad = RDF.Quad>(
  input: string,
  options?: MessageParserOptions<Q>,
): Q[][];

export class MessageStreamParser<Q extends RDF.BaseQuad = RDF.Quad> extends Transform
  implements AsyncIterable<Q[]> {
  constructor(options?: MessageParserOptions<Q>);
  on(event: 'prefix', listener: (prefix: string, term: RDF.NamedNode) => void): this;
  on(event: 'version', listener: (version: string) => void): this;
  on(event: 'data', listener: (message: Q[]) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: 'prefix', listener: (prefix: string, term: RDF.NamedNode) => void): this;
  once(event: 'version', listener: (version: string) => void): this;
  once(event: 'data', listener: (message: Q[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  [Symbol.asyncIterator](): NodeJS.AsyncIterator<Q[]>;
}

export class MessageStreamWriter extends Transform {
  constructor(options?: Omit<MessageWriterOptions, 'end'>);
}
