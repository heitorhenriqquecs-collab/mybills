const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const files = [
  'app.js',
  'cloud-config.js',
  'cloudflare/src/worker.js',
  'electron-main.js',
  'forge.config.js',
  'mybills-server.cjs',
  'preload.js',
  'server/cloud-server.cjs',
  'scripts/build-android.cjs',
  'scripts/build-brand-icons.cjs',
  'scripts/build-web.cjs',
  'scripts/inspect-runtime.cjs',
  'scripts/make-current-backup.cjs',
  'scripts/make-portable.cjs',
  'scripts/test-local-transfer.cjs'
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(projectRoot, file)], {
    stdio: 'inherit'
  });

  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`${files.length} arquivos JavaScript validados.`);
