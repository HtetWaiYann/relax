import { createConnectTransport } from '@connectrpc/connect-web';
import { createRelaxClient, type RelaxClient } from '@relax/types';

function backendUrl(): string {
  if (typeof window !== 'undefined' && window.relax?.getBackendUrl) {
    return window.relax.getBackendUrl();
  }
  return 'http://localhost:8080';
}

const transport = createConnectTransport({
  baseUrl: backendUrl(),
  useBinaryFormat: false,
});

export const relaxClient: RelaxClient = createRelaxClient(transport);
