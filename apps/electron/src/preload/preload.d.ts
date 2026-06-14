import type { RelaxBridge } from './index';

declare global {
  interface Window {
    relax: RelaxBridge;
  }
}

export {};
