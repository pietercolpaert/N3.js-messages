import type * as RDF from '@rdfjs/types';
export interface ParserSink<Q extends RDF.BaseQuad> {
  message(quads: Q[], index: number): unknown;
  end(prefixes?: Record<string, RDF.NamedNode>): unknown;
  error(error: Error): unknown;
  quad?(quad: Q, index: number): unknown;
  prefix?(prefix: string, term: RDF.NamedNode): unknown;
  version?(label: string): unknown;
}
export type Done = (error?: Error | null) => void;
export type End = (error?: Error | null, result?: string) => void;
export interface Output {
  write(chunk: string, encoding: string, done: Done): unknown;
  end(done: Done): unknown;
}
