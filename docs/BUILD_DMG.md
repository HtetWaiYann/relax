# Build a `.dmg` installer for the RELAX Electron app

The renderer is already wired for `electron-builder` — `apps/electron/package.json` has a `build` block with `appId`, `productName`, mac icon, and `extraResources`. We just need to add the builder dep, a build script, then run it.

> Must run on **macOS** to produce a `.dmg`. Other platforms can cross-build, but signing and DMG creation are easiest on Mac.

---

## 1. Install `electron-builder`

From the repo root:

```bash
pnpm --filter @relax/electron add -D electron-builder
```

## 2. Add a script

Edit `apps/electron/package.json` and add (alongside the existing `build` script):

```json
"scripts": {
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "dist:mac": "electron-vite build && electron-builder --mac dmg",
  "dist:mac-universal": "electron-vite build && electron-builder --mac dmg --universal"
}
```

`electron-builder` already reads the `build` block that's at the bottom of the same file — no separate `electron-builder.yml` needed.

## 3. (Optional) extend the `mac` build block

The current block is minimal:

```json
"mac": {
  "icon": "resources/icon.icns",
  "category": "public.app-category.entertainment"
}
```

For a polished installer you probably want:

```json
"mac": {
  "icon": "resources/icon.icns",
  "category": "public.app-category.entertainment",
  "target": [
    { "target": "dmg", "arch": ["arm64", "x64"] }
  ],
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist"
},
"dmg": {
  "title": "RELAX ${version}",
  "icon": "resources/icon.icns",
  "window": { "width": 540, "height": 380 },
  "contents": [
    { "x": 140, "y": 200, "type": "file" },
    { "x": 400, "y": 200, "type": "link", "path": "/Applications" }
  ]
}
```

If you add `entitlements`, create `apps/electron/build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.network.server</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
</dict>
</plist>
```

The network entitlements are required because the app runs a local HTTP stream server on `:8088` and talks to the backend over the network.

## 4. Build it

```bash
pnpm --filter @relax/electron run dist:mac           # current arch
pnpm --filter @relax/electron run dist:mac-universal # arm64 + x64 in one DMG
```

Outputs land in `apps/electron/dist/`:

- `RELAX-<version>-arm64.dmg`
- `RELAX-<version>-x64.dmg` (or `-universal.dmg` if you used `--universal`)
- A `mac/` or `mac-arm64/` folder with the raw `.app`

Open the `.dmg` to test the drag-to-Applications flow.

## 5. Bundling ffmpeg/ffprobe

The renderer depends on `ffmpeg-static` and `ffprobe-static` — these ship native binaries in `node_modules`. `electron-builder` includes them by default via its `asarUnpack` logic, but verify:

1. Open the produced `RELAX.app` from `apps/electron/dist/mac*/`.
2. In Finder: right-click → Show Package Contents → `Contents/Resources/app.asar.unpacked/node_modules`.
3. You should see `ffmpeg-static/` and `ffprobe-static/` with their binaries present.

If they're missing, add to the `build` block:

```json
"asarUnpack": [
  "node_modules/ffmpeg-static/**",
  "node_modules/ffprobe-static/**"
]
```

## 6. Code signing (optional but recommended)

Unsigned `.dmg` files trigger the "unidentified developer" warning. To sign with an Apple Developer ID:

```bash
export CSC_LINK=/path/to/DeveloperID.p12     # or base64 in CSC_LINK
export CSC_KEY_PASSWORD='<cert password>'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop'   # app-specific pw from appleid.apple.com
export APPLE_TEAM_ID='ABCDE12345'

pnpm --filter @relax/electron run dist:mac
```

`electron-builder` picks these up automatically and signs + notarizes the build.

Without a Developer account: users will need to right-click → Open the first time, or run `xattr -dr com.apple.quarantine /Applications/RELAX.app`.

## 7. Update the backend URL for production

The renderer reads `BACKEND_URL` from the preload at build time (defaults to `http://localhost:8080`). For a packaged build pointing at your deployed backend:

```bash
BACKEND_URL=https://relax-api.htetwaiyan.com \
  pnpm --filter @relax/electron run dist:mac
```

(Or hard-code the production URL in `apps/electron/src/preload/index.ts`.)

## Troubleshooting

- **`Error: Cannot find module 'electron-builder'`** — install step skipped; re-run `pnpm --filter @relax/electron add -D electron-builder`.
- **DMG opens but app crashes on launch** — usually a missing native module. Run the `.app` from terminal to see the real error: `./apps/electron/dist/mac-arm64/RELAX.app/Contents/MacOS/RELAX`.
- **"App is damaged and can't be opened"** — unsigned + quarantined. Either sign it (section 6) or tell test users to run the `xattr` command above.
- **Universal DMG is huge** — it bundles both arm64 and x64 binaries (Electron itself is ~250MB per arch). Ship per-arch DMGs separately if size matters.
