## `@envelop/automatic-persisted-queries`

This plugin implements configurable Apollo style Automatic Persisted Queries, with compatibility for `apollo-client`.

https://www.apollographql.com/docs/apollo-server/performance/apq/

## Getting Started

```
yarn add @envelop/automatic-persisted-queries
```

## Usage Example

```ts
import { envelop } from '@envelop/core';
import { useAutomaticPersistedQueries } from '@envelop/automatic-persisted-queries';

const getEnveloped = envelop({
  plugins: [
    // ... other plugins ...
    useAutomaticPersistedOperations({
      store: myStore,
    }),
  ],
});
```

We provide reasonable defaults for all options, and the implementation is compatible with `apollo` without
additional configuration.

### API Reference

#### `resolvePersistedQuery(context: DefaultContext): PersistedQuery | undefined`

If you wish to customize the token extraction from your HTTP request, override this function. It gets the `context`
built so far as an argument, so you can extract the query details based on your setup.

If `resolvePersistedQuery` is not set, the default behavior is to look for `req` or `request` in the context, then look for
the `persistedQuery` extension in the `body`.

> In most cases, this is the only option that will be set. The other defaults result in an `apollo-client` compatible
> implementation.

#### `store`

The store that maps query hashes to query documents. If unspecified, we provide an in-memory LRU cache capped
at `1000` elements with a ttl of an hour to prevent DoS attacks on the storage of hashes & queries.

The store interface is based on 2 simple functions, so you can connect to any `(synchronous)` key/value data store.

Here's an example of a naive, unbounded in-memory store:

```ts
import { PersistedQueryStore } from '@envelop/automatic-persisted-queries';

// You can implement `data` in any custom way, and even fetch it from a remote store.
const data: Record<string, DocumentNode | string> = {};

export const myStore: PersistedQueryStore = {
  put: (key, document) => (data[key] = document),
  get: key => data[key],
};
```

You can use the utility function `createLRUStore` to create a cache for your own purposes.

```ts
import { PersistedQueryStore, createLRUStore } from '@envelop/automatic-persisted-queries';

/** Create an LRU based store with a max of 100 items and a ttl of 1 minute */
const smallStore = createLRUStore(100, 60000);
```

> For DDOS protection, ensure that your store is capped to a reasonable size and if possible uses expiration policies.

#### `hashAlgorithm`

The algorithm used to hash query text. Possible values are `sha256`, `sha512`, `sha1`, `md5`.

Default `sha256`

#### `version`

The current protocol version. If set, the `version` field of the `persistedQuery` extension must match this value, otherwise
an error with message `PersistedQueryInvalidVersion` will be raised.

Default: `1`
