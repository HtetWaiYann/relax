#!/usr/bin/env node
// Builds the Go backend as an Electron sidecar binary. Default = current host
// (matches what electron-builder is about to package). Set TARGETS to a
// comma-separated list of `goos/goarch` pairs to cross-compile (e.g.
// `TARGETS=darwin/arm64,darwin/amd64,linux/amd64,windows/amd64`).
//
// ponytail: host-only by default. Cross-compile matrix is opt-in via env var,
// add CI fan-out when you actually ship multi-platform installers.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, '..');
const outRoot = resolve(backendDir, '../electron/resources/bin');

const targets = process.env.TARGETS
  ? process.env.TARGETS.split(',').map(t => {
      const [goos, goarch] = t.trim().split('/');
      if (!goos || !goarch) throw new Error(`bad TARGETS entry: ${t}`);
      return { goos, goarch };
    })
  : [{ goos: process.platform === 'win32' ? 'windows' : process.platform, goarch: process.arch === 'arm64' ? 'arm64' : 'amd64' }];

// Map node's process.platform -> goos.
for (const t of targets) {
  if (t.goos === 'darwin') t.goos = 'darwin';
  if (t.goos === 'win32') t.goos = 'windows';
}

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const { goos, goarch } of targets) {
  const exe = goos === 'windows' ? 'relaxd.exe' : 'relaxd';
  // ponytail: flat layout. Runtime reads resources/bin/<exe>; per-arch subdirs
  // would never get picked up. electron-builder's beforePack drives one target
  // per pack iteration, so the last entry wins if multiple are passed.
  mkdirSync(outRoot, { recursive: true });
  const outPath = join(outRoot, exe);
  console.log(`[build-sidecar] ${goos}/${goarch} -> ${outPath}`);
  const res = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', outPath, './cmd/relaxd'], {
    cwd: backendDir,
    env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
    stdio: 'inherit',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);

  // ponytail: bake the dev .env into the sidecar dir so godotenv.Load() picks
  // it up at spawn time (TMDB_API_KEY etc). Portfolio shortcut — for a public
  // release, prompt for keys in-app or use ldflag-embedded values.
  const envSrc = resolve(backendDir, '.env');
  if (existsSync(envSrc)) {
    copyFileSync(envSrc, join(outRoot, '.env'));
    console.log(`[build-sidecar] embedded .env`);
  } else {
    console.warn(`[build-sidecar] WARN: ${envSrc} not found — packaged app will start without TMDB_API_KEY`);
  }
}

console.log('[build-sidecar] done');
