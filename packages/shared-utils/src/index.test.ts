import { describe, expect, it } from 'vitest';
import { APP_NAME, DEFAULT_BACKEND_PORT, DEFAULT_BACKEND_URL } from './index.js';

describe('shared constants', () => {
  it('exposes the app name', () => {
    expect(APP_NAME).toBe('RELAX');
  });

  it('exposes a numeric default port', () => {
    expect(DEFAULT_BACKEND_PORT).toBe(8080);
  });

  it('builds a localhost backend URL from the port', () => {
    expect(DEFAULT_BACKEND_URL).toBe(`http://localhost:${DEFAULT_BACKEND_PORT}`);
  });
});
