import { MessageParser, parseMessages, MessageStreamParser, MessageStreamWriter, MessageWriter, writeMessages } from '../../browser.js';
import type { Quad } from '@rdfjs/types';
const messages: Quad[][] = new MessageParser().parse('<a> <b> <c> .');
const readable: ReadableStream<Quad[]> = new ReadableStream<Uint8Array>()
  .pipeThrough(new MessageStreamParser({ onPrefix: (prefix, term) => { void prefix; void term; } }));
const text: ReadableStream<string> = readable.pipeThrough(new MessageStreamWriter());
const writer = new MessageWriter();
void [writer, text, writeMessages(messages), parseMessages('')];
// @ts-expect-error: browser parser accepts text, not Node streams or arbitrary objects
new MessageParser().parse({ on() {} });
// @ts-expect-error: messages contain quads
writeMessages([[42]]);
// @ts-expect-error: Web Streams inputs are text or bytes
new ReadableStream<number>().pipeThrough(new MessageStreamParser());
