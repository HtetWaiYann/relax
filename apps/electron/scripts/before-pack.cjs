/* eslint-env node */
// electron-builder beforePack hook: rebuilds the Go sidecar for the exact
// goos/goarch of the current pack iteration, so each installer ships only its
// own native binary at the flat resources/bin/ path the main process reads.
// Also re-fetches the node-datachannel prebuild for the target arch, since
// `prebuild-install` only ran once for the host machine at `pnpm install` time.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const GOARCH = { 0: 'ia32', 1: 'amd64', 3: 'arm64' };
const GOOS = { darwin: 'darwin', win32: 'windows', linux: 'linux' };
const NODE_ARCH = { 0: 'ia32', 1: 'x64', 3: 'arm64' };
const NODE_PLATFORM = { darwin: 'darwin', win32: 'win32', linux: 'linux' };

// node-datachannel doesn't export ./package.json, and under pnpm it isn't a
// direct dep of this workspace — resolve it via webtorrent, then walk up to
// the package root.
function resolveNodeDatachannelRoot() {
  const wtDir = path.dirname(require.resolve('webtorrent/package.json'));
  const entry = require.resolve('node-datachannel', { paths: [wtDir] });
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).name === 'node-datachannel') {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('[before-pack] could not locate node-datachannel package root');
}

module.exports = async function beforePack(context) {
  const goos = GOOS[context.electronPlatformName];
  const goarch = GOARCH[context.arch];
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

  const nodePlatform = NODE_PLATFORM[context.electronPlatformName];
  const nodeArch = NODE_ARCH[context.arch];
  const ndcDir = resolveNodeDatachannelRoot();
  console.log(`[before-pack] fetching node-datachannel prebuild for ${nodePlatform}/${nodeArch} in ${ndcDir}`);
  const ndc = spawnSync(
    'npx',
    ['--yes', 'prebuild-install', '-r', 'napi', '--platform', nodePlatform, '--arch', nodeArch, '--force'],
    { cwd: ndcDir, stdio: 'inherit' },
  );
  if (ndc.status !== 0) {
    throw new Error(`[before-pack] prebuild-install for node-datachannel failed (exit ${ndc.status})`);
  }
};
