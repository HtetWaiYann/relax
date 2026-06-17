// electron-builder beforePack hook: rebuilds the Go sidecar for the exact
// goos/goarch of the current pack iteration, so each installer ships only its
// own native binary at the flat resources/bin/ path the main process reads.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ARCH = { 0: 'ia32', 1: 'amd64', 3: 'arm64' };
const OS = { darwin: 'darwin', win32: 'windows', linux: 'linux' };

module.exports = async function beforePack(context) {
  const goos = OS[context.electronPlatformName];
  const goarch = ARCH[context.arch];
  if (!goos || !goarch) {
    throw new Error(`[before-pack] unsupported target: ${context.electronPlatformName}/${context.arch}`);
  }
  console.log(`[before-pack] building sidecar for ${goos}/${goarch}`);
  const backendDir = path.resolve(__dirname, '../../backend');
  const res = spawnSync('node', ['./scripts/build-sidecar.mjs'], {
    cwd: backendDir,
    env: { ...process.env, TARGETS: `${goos}/${goarch}` },
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error(`[before-pack] build-sidecar failed (exit ${res.status})`);
};
