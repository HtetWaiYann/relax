// Renderer-side type declarations live in src/renderer/src/lib/torrent.ts
// (declare global Window there). This file only re-asserts the bridge so the
// preload program is internally consistent.
import type { RelaxBridge } from './index';

export type { RelaxBridge };

