import { DefaultContext, Plugin } from '@envelop/types';
import { DocumentNode } from 'graphql';
import crypto from 'crypto';
import { createLRUStore, PersistedQueryStore } from './store';
import { EnvelopError } from '@envelop/core';

export class PersistedQueryError extends EnvelopError {}

const errors = {
  NOT_SUPPORTED: 'PersistedQueryNotSupported',
  NOT_FOUND: 'PersistedQueryNotFound',
  HASH_MISSING: 'PersistedQueryHashMissing',
  INVALID_VERSION: 'Unsupported persisted query version',
  HASH_MISMATCH: 'PersistedQueryHashMismatch',
};

const codes = {
  NOT_SUPPORTED: 'PERSISTED_QUERY_NOT_SUPPORTED',
  NOT_FOUND: 'PERSISTED_QUERY_NOT_FOUND',
  HASH_MISSING: 'PERSISTED_QUERY_HASH_MISSING',
  INVALID_VERSION: 'PERSISTED_QUERY_INVALID_VERSION',
  HASH_MISMATCH: 'PERSISTED_QUERY_HASH_MISMATCH',
};

const DEFAULT_PROTOCOL_VERSION = 1;
const PERSISTED_QUERY_EXTENSION_KEY = 'persistedQuery';

const ALGORITHMS = ['sha256', 'sha512', 'sha1', 'md5'] as const;

export type HashAlgorithm = typeof ALGORITHMS[number];

export interface PersistedQuery {
  version: number;
  hash: string;
}

export interface UseAutomaticPersistedQueryOptions {
  /**
   * The query hash algorithm
   */
  hashAlgorithm?: HashAlgorithm;
  /**
   * The protocol version
   */
  version?: number;
  /**
   *  Retrieve the persisted query data from a request.
   */
  resolvePersistedQuery?: (context: Readonly<DefaultContext>) => PersistedQuery | undefined;
  /**
   *  Storage for persisted queries.
   */
  store?: PersistedQueryStore;
  /**
   * Writes operation id to the context (enabled by default)
   */
  writeToContext?: boolean;
}

export const DEFAULT_HASH_ALGORITHM: HashAlgorithm = 'sha256';

export function generateHash(query: string, algo: HashAlgorithm): string {
  return crypto.createHash(algo).update(query, 'utf8').digest('hex');
}

function getPersistedQueryFromContext(context: Readonly<DefaultContext>, algorithm: HashAlgorithm): PersistedQuery | undefined {
  const ctx = context as any;
  const body = (ctx.request ?? ctx.req)?.body;
  const pq = body?.extensions?.[PERSISTED_QUERY_EXTENSION_KEY];
  if (pq) {
    const key = `${algorithm as string}Hash`;
    if (typeof pq.version !== 'number' && pq[key] === undefined) {
      throw new PersistedQueryError(errors.NOT_FOUND, { code: codes.NOT_FOUND });
    }
    const hash = pq[key];
    const version = pq.version ?? 0;
    return { hash, version };
  }
  return undefined;
}

const symbolInContext = Symbol('automaticPersistedQueryId');

type PluginContext<TOptions extends Partial<UseAutomaticPersistedQueryOptions>> = TOptions['writeToContext'] extends true
  ? { [symbolInContext]: string }
  : {};

export const useAutomaticPersistedQueries = <TOptions extends UseAutomaticPersistedQueryOptions>(
  options?: TOptions
): Plugin<PluginContext<TOptions>> => {
  // Load the persisted query settings
  const {
    store: _store,
    version: expectedVersion = DEFAULT_PROTOCOL_VERSION,
    resolvePersistedQuery: _resolvePersistedQuery,
    hashAlgorithm = DEFAULT_HASH_ALGORITHM,
  } = {
    ...(options || {}),
  };

  const store = _store ?? createLRUStore();
  const writeToContext = options?.writeToContext !== false;

  const getPersistedQuery = _resolvePersistedQuery ?? (context => getPersistedQueryFromContext(context, hashAlgorithm));

  return {
    onParse({ context, parseFn, params: { source }, setParsedDocument, extendContext }) {
      const persistedQuery = getPersistedQuery(context);
      const query = typeof source === 'string' ? source : source.body;

      // Verify if a query matches the persisted format
      let result: DocumentNode | undefined;
      let queryHash: string | undefined;

      if (persistedQuery) {
        // This is a persisted query, so we use the hash in the request
        // to load the full query document.

        let cachedQuery: DocumentNode | string | null;

        // Extract the hash from the request
        const { hash, version } = persistedQuery;

        if (typeof version === 'number' && version !== expectedVersion) {
          throw new PersistedQueryError(errors.INVALID_VERSION, { code: codes.INVALID_VERSION });
        }

        queryHash = hash;

        if (query === undefined) {
          if (!queryHash) {
            throw new PersistedQueryError(errors.HASH_MISSING, { code: codes.HASH_MISSING });
          }

          cachedQuery = store.get(queryHash);
          if (!cachedQuery) {
            // Query has not been found, tell the client.
            throw new PersistedQueryError(errors.NOT_FOUND, { code: codes.NOT_FOUND });
          }

          result = typeof cachedQuery === 'string' ? parseFn(cachedQuery) : cachedQuery;

          if (writeToContext) {
            extendContext({
              [symbolInContext]: source,
            } as PluginContext<{ writeToContext: true }>);
          }

          setParsedDocument(result);
          return;
        } else {
          const computedQueryHash = generateHash(query, hashAlgorithm);

          // The provided hash must exactly match the hash of
          // the query string. This prevents hash hijacking, where a
          // new and potentially malicious query is associated with
          // an existing hash.
          if (queryHash !== computedQueryHash) {
            throw new PersistedQueryError(`Provided ${hashAlgorithm} hash does not match query`, { code: codes.HASH_MISMATCH });
          }
        }
      } else if (query) {
        // Compute the APQ query hash to use as our cache key
        // Question? should we do this automatically
        queryHash = generateHash(query, hashAlgorithm);
      } else {
        throw new PersistedQueryError('GraphQL operations must contain a non-empty `query` or a `persistedQuery` extension.', {
          code: 'INTERNAL_SERVER_ERROR',
        });
      }

      return ({ result }) => {
        if (!result || result instanceof Error) return;
        // save queries which are not yet persisted.
        if (queryHash) {
          store.put(queryHash, result);
        }
      };
    },
  };
};
