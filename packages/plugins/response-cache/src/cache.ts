import type { Maybe, PromiseOrValue } from '@envelop/core';
import type { ExecutionResult } from 'graphql';

export type CacheInvalidationRecord = {
  typename: string;
  id?: number | string;
};

/**
 * Interface for implementing a cache that will be used for `useResponseCache`.
 */
export type Cache = {
  /** set a cache response */
  set(
    /** id/hash of the operation */
    id: string,
    /** the result that should be cached */
    data: ExecutionResult,
    /** array of typename and entityId tuples */
    collectedEntities: Array<[string, Maybe<string>]>,
    /** how long the operation should be cached */
    ttl: number
  ): PromiseOrValue<void>;
  /** get a cached response */
  get(id: string): PromiseOrValue<Maybe<ExecutionResult>>;
  /** invalidate operations via typename or id */
  invalidate(entityIds: Iterable<CacheInvalidationRecord>): PromiseOrValue<void>;
};
