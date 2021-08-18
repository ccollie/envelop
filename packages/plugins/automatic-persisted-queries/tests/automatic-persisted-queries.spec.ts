'use strict';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { assertSingleExecutionValue, createTestkit } from '@envelop/testing';
import {
  generateHash,
  HashAlgorithm,
  PersistedQuery,
  useAutomaticPersistedQueries,
  UseAutomaticPersistedQueryOptions,
} from '../src';

describe('useAutomaticPersistedQueries', () => {
  const testSchema = makeExecutableSchema({
    resolvers: {
      Query: {
        hello: () => 'hi',
        add: (_, { x, y }) => x + y,
      },
    },
    typeDefs: /* GraphQL */ `
      type Query {
        hello: String
        add(x: Int, y: Int): Int
      }
    `,
  });

  const query = `
  query AddQuery ($x: Int!, $y: Int!) {
      add(x: $x, y: $y)
  }`;

  const TEST_STRING_QUERY = query;
  const sha256Hash = generateHash(query, 'sha256');
  const variables = { x: 1, y: 2 };

  // Create object to merge into the simulated request
  function createContext(pq: Partial<PersistedQuery>, algorithm: HashAlgorithm = 'sha256'): Record<string, any> {
    const result = Object.create(null);
    const { version, hash } = pq;
    const persistedQuery = Object.create(null);
    if (typeof version === 'number') persistedQuery.version = version;
    if (typeof hash === 'string') {
      const key = `${algorithm}Hash`;
      persistedQuery[key] = version;
    }
    result.body = {
      extensions: {
        persistedQuery,
      },
    };
    return result;
  }

  async function executeOperation(
    options: UseAutomaticPersistedQueryOptions,
    query: string,
    persistedQuery: Partial<PersistedQuery>,
    variables: Record<string, any> = {}
  ): Promise<any> {
    const testInstance = createTestkit([useAutomaticPersistedQueries(options)], testSchema);
    const context = createContext(persistedQuery);
    const result = await testInstance.execute(query, variables, context);
    assertSingleExecutionValue(result);
    return result;
  }

  test('APQ errors on invalid extension without persistedQueries', async () => {
    const res = await executeOperation({}, TEST_STRING_QUERY, {});

    expect(res.data).not.toBeDefined();
    expect(Array.isArray(res.errors)).toBeTruthy();
    expect(res.errors[0].message).toBe('Unsupported persisted query version');
    expect(res.errors[0].extensions.code).toBe('PERSISTED_QUERY_INVALID_VERSION');
  });

  const persistedQuery = {
    version: 1,
    hash: sha256Hash,
  };

  it('returns PersistedQueryNotFound on the first try', async () => {
    const result = await executeOperation({}, /* undefined */ TEST_STRING_QUERY, {
      version: 1,
      hash: sha256Hash,
    });

    expect(result.data).toBeUndefined();
    expect(result.errors.length).toEqual(1);
    expect(result.errors[0].message).toEqual('PersistedQueryNotFound');
    expect(result.errors[0].extensions.code).toEqual('PERSISTED_QUERY_NOT_FOUND');
  });

  it('returns result on the second try', async () => {
    const testInstance = createTestkit([useAutomaticPersistedQueries()], testSchema);
    const context = createContext(persistedQuery);
    let result = await testInstance.execute(query ?? undefined, variables, context);
    assertSingleExecutionValue(result);

    result = await testInstance.execute(TEST_STRING_QUERY, variables, context);
    assertSingleExecutionValue(result);

    expect(result.errors).toBeUndefined();
    expect(result.data?.add).toBe(3);
  });

  it('returns result on the persisted query', async () => {
    const variables = { x: 1, y: 2 };
    const persistedQuery = { version: 1, hash: sha256Hash };

    const testInstance = createTestkit([useAutomaticPersistedQueries()], testSchema);

    const context = createContext(persistedQuery);

    await testInstance.execute(TEST_STRING_QUERY, variables, context);

    const result = await testInstance.execute(TEST_STRING_QUERY, variables, context);
    assertSingleExecutionValue(result);

    expect(result.data?.add).toBe(3);
    expect(result.errors).toBeUndefined();
  });

  it('returns error when hash does not match', async () => {
    try {
      await executeOperation({}, TEST_STRING_QUERY, {
        version: 1,
        hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
    } catch (e) {
      expect(e.response).toBeDefined();
      expect(e.response.status).toEqual(400);
      expect(e.response.raw).toMatch(/does not match query/);
    }
  });

  it('errors when version is not specified', async () => {
    const result = await executeOperation({}, query, {
      // Version intentionally omitted.
      hash: sha256Hash,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Unsupported persisted query version',
        }),
      ])
    );
  });

  it('errors when version is unsupported', async () => {
    const result = await executeOperation({ version: 1 }, query, {
      // Version intentionally wrong.
      version: 2,
      hash: sha256Hash,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Unsupported persisted query version',
        }),
      ])
    );
  });
});
