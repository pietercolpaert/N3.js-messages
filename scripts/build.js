import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
// Remove obsolete files, including modules deleted or renamed since the last build.
for (const directory of ['lib', 'browser'])
  rmSync(new URL(`../${directory}`, import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [path.join(path.dirname(require.resolve('@babel/cli/package.json')), 'bin/babel.js'), 'src', '-d', 'lib',
  '--ignore', 'src/browser.js', '--source-maps'], { cwd: root, stdio: 'inherit' });
writeFileSync(new URL('../lib/package.json', import.meta.url), '{ "type": "commonjs" }\n');
mkdirSync(new URL('../browser', import.meta.url));

// Import only N3's parser, writer, and factory. Node stream exports are not needed in browsers.
const n3Browser = {
  name: 'n3-browser-core',
  setup(builder) {
    builder.onResolve({ filter: /^n3$/ }, () => ({ path: 'n3-browser-core', namespace: 'n3-core' }));
    builder.onLoad({ filter: /.*/, namespace: 'n3-core' }, () => ({
      contents: `export { default as Parser } from 'n3/src/N3Parser.js';
export { default as Writer } from 'n3/src/N3Writer.js';
export { default as DataFactory } from 'n3/src/N3DataFactory.js';`,
      resolveDir: root,
    }));
  },
};
const common = {
  absWorkingDir: root,
  entryPoints: ['src/browser.js'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  footer: { js: '/*! Third-party licenses: ./THIRD-PARTY-LICENSES.txt */' },
  alias: { events: require.resolve('events/'), ['string_decoder']: require.resolve('string_decoder/') },
  plugins: [n3Browser],
  metafile: true,
};
const dependencies = new Set();
for (const format of ['esm', 'iife']) {
  const result = await build({ ...common, format, globalName: 'N3Messages',
    outfile: format === 'esm' ? 'browser/index.js' : 'browser/index.global.js' });
  for (const input of Object.keys(result.metafile.inputs)) {
    // Resolve each owning package, including dependencies reached through symlinks.
    let directory = path.dirname(path.resolve(root, input));
    while (directory !== path.resolve(root) && directory !== path.dirname(directory)) {
      if (existsSync(path.join(directory, 'package.json'))) {
        dependencies.add(directory);
        break;
      }
      directory = path.dirname(directory);
    }
  }
  for (const output of Object.values(result.metafile.outputs))
    if (output.imports.some(entry => entry.external))
      throw new Error('The browser bundle must be self-contained');
}

// Bundled dependencies must retain their complete copyright and license notices.
const notices = [...dependencies].sort().map(directory => {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const license = readdirSync(directory).find(file => /^licen[sc]e(?:\.|$)/i.test(file));
  if (!license) throw new Error(`Missing license for bundled dependency ${manifest.name}`);
  return `${manifest.name}@${manifest.version}\n${readFileSync(path.join(directory, license), 'utf8')}`;
});
writeFileSync(new URL('../browser/THIRD-PARTY-LICENSES.txt', import.meta.url), notices.join('\n\n'));
