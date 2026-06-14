import { createClient, type Transport } from '@connectrpc/connect';
import { RelaxService } from './gen/relax/v1/relax_service_pb.js';

export * from './gen/relax/v1/torrent_pb.js';
export * from './gen/relax/v1/media_pb.js';
export * from './gen/relax/v1/watch_progress_pb.js';
export * from './gen/relax/v1/relax_service_pb.js';

export function createRelaxClient(transport: Transport) {
  return createClient(RelaxService, transport);
}

export type RelaxClient = ReturnType<typeof createRelaxClient>;
