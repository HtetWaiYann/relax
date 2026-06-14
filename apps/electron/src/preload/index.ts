import { contextBridge } from 'electron';

const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8080';

const api = {
  getBackendUrl: (): string => BACKEND_URL,
  getAppName: (): string => 'RELAX',
} as const;

contextBridge.exposeInMainWorld('relax', api);

export type RelaxBridge = typeof api;
