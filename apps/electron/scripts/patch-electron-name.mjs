import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const plist = join(dirname(require.resolve('electron/package.json')), 'dist/Electron.app/Contents/Info.plist');
const patch = (key, val) =>
  execSync(`/usr/libexec/PlistBuddy -c "Set ${key} ${val}" "${plist}"`, { stdio: 'ignore' });

patch('CFBundleName', 'Relax');
patch('CFBundleDisplayName', 'Relax');
