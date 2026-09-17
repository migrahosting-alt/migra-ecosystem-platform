import type { PostgresDurableStore } from '../persistence/postgresStore.js';
import type {
  EngineerCheckpointPayloadV1,
  EngineerCheckpointScope,
  EngineerCheckpointStatus,
  EngineerCheckpointStore,
} from './engineerCheckpointStore.js';

/**
 * Narrow persistence adapter for Engineer.
 *
 * It deliberately exposes none of PostgresDurableStore's unrelated APIs, which
 * keeps persistence a dependency of the route/controller boundary rather than
 * turning the Engineer runtime into a database client.
 */
export class PostgresEngineerCheckpointStore implements EngineerCheckpointStore {
  constructor(private readonly durable: PostgresDurableStore) {}

  save(
    scope: EngineerCheckpointScope,
    checkpoint: EngineerCheckpointPayloadV1,
  ): Promise<void> {
    return this.durable.saveEngineerCheckpoint(scope, checkpoint);
  }

  load(
    scope: EngineerCheckpointScope,
    correlationId: string,
  ): Promise<EngineerCheckpointPayloadV1 | null> {
    return this.durable.loadEngineerCheckpoint(scope, correlationId);
  }

  markStatus(
    scope: EngineerCheckpointScope,
    correlationId: string,
    status: EngineerCheckpointStatus,
    updatedAt: string,
  ): Promise<boolean> {
    return this.durable.markEngineerCheckpointStatus(
      scope,
      correlationId,
      status,
      updatedAt,
    );
  }
}
