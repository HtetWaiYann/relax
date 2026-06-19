/* eslint-env node */
// electron-builder afterAllArtifactBuild hook: re-fetch the node-datachannel
// prebuild for the host platform/arch, so `pnpm dev` keeps working after a
// cross-arch pack (e.g. dist:all) overwrote the host binary in node_modules.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
  throw new Error('[after-all-artifact-build] could not locate node-datachannel package root');
}

module.exports = async function afterAllArtifactBuild() {
  const ndcDir = resolveNodeDatachannelRoot();
  console.log(`[after-all-artifact-build] restoring host node-datachannel prebuild (${process.platform}/${process.arch})`);
  const res = spawnSync('npx', ['--yes', 'prebuild-install', '-r', 'napi', '--force'], {
    cwd: ndcDir,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.warn(`[after-all-artifact-build] prebuild-install failed (exit ${res.status}); run 'pnpm install' to restore`);
  }
  return [];
};
