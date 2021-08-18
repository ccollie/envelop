import { DocumentNode } from 'graphql';
import LRU from 'tiny-lru';

export interface PersistedQueryStore {
  /**
   * Transforms a hash/id into a DocumentNode or SDL string.
   * Prefer returning `DocumentNode` if available to avoid additional parsing phase.
   * Return `undefined` in case of a store miss.
   * @param hash
   */
  get(hash: string): string | DocumentNode | null;

  /**
   *  Save a query, given its hash.
   */
  put: (hash: string, query: string | DocumentNode) => void;
}

const DEFAULT_MAX = 1000;
const DEFAULT_TTL = 3600000;

export const createLRUStore = (maxSize?: number, ttl?: number): PersistedQueryStore => {
  maxSize = maxSize ?? DEFAULT_MAX;
  ttl = ttl ?? DEFAULT_TTL;

  // Initialize a LRU cache in the local scope.
  // LRU is used to prevent DoS attacks.
  const cache = LRU<DocumentNode | string>(maxSize, ttl);
  return {
    get(hash: string) {
      return cache.get(hash) ?? null;
    },
    put(hash: string, query: string | DocumentNode) {
      cache.set(hash, query);
    },
  };
};