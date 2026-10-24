// Check the implementation's inferred API against the published declarations.
import * as implementation from '../../src/index.js';
import * as declared from '../../index.js';
const parser: typeof declared.MessageParser = implementation.MessageParser;
const parse: typeof declared.parseMessages = implementation.parseMessages;
const write: typeof declared.writeMessages = implementation.writeMessages;
const stream: typeof declared.MessageStreamParser = implementation.MessageStreamParser;
void [parser, parse, write, stream];

import * as browserImplementation from '../../src/browser.js';
import * as browserDeclaration from '../../browser.js';
const webParser: typeof browserDeclaration.MessageStreamParser = browserImplementation.MessageStreamParser;
const webWriter: typeof browserDeclaration.MessageStreamWriter = browserImplementation.MessageStreamWriter;
const nodeWriter: typeof declared.MessageStreamWriter = implementation.MessageStreamWriter;
void [webParser, webWriter, nodeWriter];
