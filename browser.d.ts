import type * as RDF from '@rdfjs/types';
import type { MessageParserOptions, MessageCallback, MessageParseCallbacks, MessageWriterOptions } from './common.js';
export * from './common.js';

export class MessageParser<Q extends RDF.BaseQuad = RDF.Quad> {
  constructor(options?: MessageParserOptions<Q>);
  parse(input: string): Q[][];
  parse(input: string, callback: MessageCallback<Q>): void;
  parse(input: string, callbacks: MessageParseCallbacks<Q>): void;
}
export function parseMessages<Q extends RDF.BaseQuad = RDF.Quad>(input: string, options?: MessageParserOptions<Q>): Q[][];

export type MessageChunk = string | ArrayBuffer | ArrayBufferView;
export interface BrowserParserOptions<Q extends RDF.BaseQuad = RDF.Quad> extends MessageParserOptions<Q> {
  onPrefix?: (prefix: string, term: RDF.NamedNode) => void;
  onVersion?: (version: string) => void;
}
/** Use source.pipeThrough(new MessageStreamParser(options)). */
export class MessageStreamParser<Q extends RDF.BaseQuad = RDF.Quad> extends TransformStream<MessageChunk, Q[]> {
  constructor(options?: BrowserParserOptions<Q>);
}
export type MessageWriterInput = RDF.BaseQuad[] | { quad: RDF.BaseQuad; messageIndex?: number };
/** Emits strings; pipe through TextEncoderStream to obtain UTF-8 bytes. */
export class MessageStreamWriter extends TransformStream<MessageWriterInput, string> {
  constructor(options?: Omit<MessageWriterOptions, 'end'>);
}
