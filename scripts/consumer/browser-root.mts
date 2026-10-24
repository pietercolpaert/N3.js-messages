// With the browser condition enabled, the root import resolves to Web Streams types.
import { MessageStreamParser, MessageStreamWriter } from 'n3.js-messages';
const parsed = new MessageStreamParser().readable;
const written: ReadableStream<string> = parsed.pipeThrough(new MessageStreamWriter());
void written;
