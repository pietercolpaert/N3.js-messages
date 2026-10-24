// Pinned N3.js grammar cases, replayed through our wrapper and its chunked stream API.
import { parseChunks } from './util.js';
import { parseMessages } from '../src/index.js';
import { DataFactory } from 'n3';
import { isomorphic } from 'rdf-isomorphic';
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync('test/fixtures/n3-parser-cases.json', 'utf8'));
function term(value) {
  switch (value.termType) {
  case 'NamedNode': return DataFactory.namedNode(value.value);
  case 'BlankNode': return DataFactory.blankNode(value.value);
  case 'DefaultGraph': return DataFactory.defaultGraph();
  case 'Variable': return DataFactory.variable(value.value);
  case 'Literal': return DataFactory.literal(value.value, value.language ?
    value.direction ? { language: value.language, direction: value.direction } : value.language : DataFactory.namedNode(value.datatype));
  case 'Quad': return DataFactory.quad(term(value.subject), term(value.predicate), term(value.object), term(value.graph));
  default: throw new Error(`Unknown fixture term ${value.termType}`);
  }
}

// Comments are not exposed by this package; unsupported versions are intentionally rejected.
const cases = fixture.cases.filter(testCase =>
  ['parse', 'error', 'resolve'].includes(testCase.kind) && !testCase.options.parseUnsupportedVersions &&
  (testCase.options.format === undefined || typeof testCase.options.format === 'string') &&
  // N3's unspecified format accepts quad extensions to Turtle; our default is strict TriG.
  !(testCase.options.format === undefined && !testCase.input.includes('{') &&
    testCase.expected?.some(quad => quad[3].termType !== 'DefaultGraph')));

describe(`Upstream N3 grammar (${fixture.commit.slice(0, 8)})`, () => {
  for (const testCase of cases) {
    it(`${testCase.suite}: ${testCase.name}`, () => {
      const sync = () => parseMessages(testCase.input, testCase.options).flat();
      const stream = () => parseChunks([...testCase.input], testCase.options).flat();
      for (const parse of [sync, stream]) {
        if (testCase.kind === 'error')
          expect(parse).toThrow();
        else if (testCase.kind === 'resolve')
          expect(parse()[0].object.value).toBe(testCase.expectedIri);
        else {
          if (testCase.name === 'should parse a reified triple in a graph using annotation syntax with one predicate-object') {
            // RDF 1.2 TriG annotations belong to the active graph (also fixed upstream).
            for (const quad of testCase.expected)
              if (quad[1].value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies')
                quad[3] = { termType: 'NamedNode', value: 'http://example.org/G' };
          }
          const expected = testCase.expected.map(quad => DataFactory.quad(...quad.map(term)));
          expect(isomorphic(parse(), expected)).toBe(true);
        }
      }
    });
  }
});
