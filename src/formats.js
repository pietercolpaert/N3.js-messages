// **formats** describes the RDF syntaxes that support RDF Messages.

/** @type {Record<string, { name: string; lineMode: boolean }>} */
const FORMATS = {
  turtle: { name: 'Turtle', lineMode: false },
  trig: { name: 'TriG', lineMode: false },
  ntriples: { name: 'N-Triples', lineMode: true },
  nquads: { name: 'N-Quads', lineMode: true },
};

// The version labels of RDF 1.2 syntaxes, as accepted by N3.js
const BASE_VERSIONS = ['1.2', '1.2-basic', '1.1'];

// ### `resolveFormat` maps a format name or media type to a supported syntax
/** @returns {{ name: string; lineMode: boolean; version?: string }} */
export function resolveFormat(format = 'TriG') {
  const key = String(format).toLowerCase().replace(/;[\s\S]*$/, '').trim()
    .replace(/^(?:text|application)\//, '')
    .replace(/^x-/, '')
    .replace(/[-_ ]/g, '');
  const resolved = FORMATS[key];
  if (!resolved)
    throw new TypeError(`Unsupported RDF Messages format: "${format}". ` +
                        'Supported formats are Turtle, TriG, N-Triples and N-Quads.');
  let version;
  // Consume quoted values whole, so a semicolon inside another parameter cannot
  // accidentally introduce a version parameter. Parameter names are case-insensitive.
  for (const parameter of String(format).matchAll(/;\s*([^;=\s]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)\s*(?=;|$)/g)) {
    if (/** @type {string} */ (parameter[1]).toLowerCase() === 'version') {
      if (version !== undefined)
        throw new TypeError('Duplicate RDF version parameter.');
      version = /** @type {string} */ (parameter[2]).trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1');
    }
  }
  return version === undefined ? resolved : { ...resolved, version };
}

/** @param {unknown} version */
// ### `isMessagesVersion` checks whether a version label announces RDF Messages
export function isMessagesVersion(version) {
  return typeof version === 'string' && version.endsWith('-messages');
}

/** @param {string} version */
// ### `baseVersion` strips the `-messages` suffix of a version label
export function baseVersion(version) {
  return isMessagesVersion(version) ? version.slice(0, -'-messages'.length) : version;
}

/** @param {string} version */
// ### `isSupportedVersion` checks whether a (base) version label is supported
export function isSupportedVersion(version, supported = BASE_VERSIONS) {
  return supported.includes(version);
}
