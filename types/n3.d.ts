// N3 2.x APIs used here that are absent from @types/n3 1.x.
// Keep this boundary small; the peer-version matrix exercises it at runtime.
import 'n3';
import type * as RDF from '@rdfjs/types';
import type { BaseQuad, Quad } from '@rdfjs/types';
import type { EventEmitter } from 'node:events';
declare module 'n3' {
  namespace Parser {
    const SUPPORTED_VERSIONS: string[];
  }
  interface ParserOptions {
    version?: string;
    parseUnsupportedVersions?: boolean;
    directives?: string[];
  }
  interface Parser<Q extends BaseQuad = Quad> {
    parse(input: EventEmitter, callbacks: {
      onQuad: (error: Error | null, quad: Q | null, prefixes?: Record<string, RDF.NamedNode>) => void;
      onPrefix: (prefix: string, term: RDF.NamedNode) => void;
      onVersion: (label: string) => void;
      onDirective: () => void;
      onToken: (token: { line: number; type: string }) => void;
    }): void;
  }
  interface WriterOptions {
    version?: string;
  }
  interface Writer<Q extends RDF.BaseQuad = RDF.Quad> {
    _lineMode: boolean;
    _endStatement(): void;
    _write(text: string): void;
    addQuad(subject: Q['subject'], predicate: Q['predicate'], object: Q['object'], graph: Q['graph'], done: (error?: Error | null) => void): void;
  }
}
