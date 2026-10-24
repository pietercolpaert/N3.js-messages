// Explicit opt-in: package installation never changes a consumer's Git settings.
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

chmodSync(new URL('../.githooks/pre-commit', import.meta.url), 0o755);
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
console.log('Installed pre-commit hook (npm run check).');
