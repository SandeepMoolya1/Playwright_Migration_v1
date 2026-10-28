/**
 * Test-owned data builders.
 *
 * A factory produces a complete, valid entity with sensible defaults, and
 * lets a test override only the field it actually cares about. That keeps the
 * test's intent visible:
 *
 *   const todo = factory.todo({ completed: true });   // this test is about completion
 *
 * Every generated string carries the run tag, so anything left behind in a
 * shared environment is attributable and sweepable. Do not remove the tag
 * from a factory — a test that needs an untagged value should say so
 * explicitly by passing one in.
 */
import { runTag, unique, uniqueEmail } from './run.js';

export interface TodoSeed {
  id: string;
  title: string;
  completed: boolean;
}

export interface UserSeed {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'standard' | 'admin';
}

export interface AddressSeed {
  line1: string;
  city: string;
  postcode: string;
  country: string;
}

export interface OrderSeed {
  reference: string;
  items: Array<{ sku: string; quantity: number }>;
  address: AddressSeed;
}

/** `crypto.randomUUID` is available in Node 22+ and every supported browser. */
const uuid = (): string => globalThis.crypto.randomUUID();

export const factory = {
  /**
   * A todo. The title is tagged, which also makes it a reliable thing to
   * filter on — no other item in the list can match it.
   */
  todo(overrides: Partial<TodoSeed> = {}): TodoSeed {
    return {
      id: uuid(),
      title: `${runTag()} ${unique('todo')}`,
      completed: false,
      ...overrides,
    };
  },

  /** `n` todos, useful for list, pagination and filter tests. */
  todos(n: number, overrides: Partial<TodoSeed> = {}): TodoSeed[] {
    return Array.from({ length: n }, () => factory.todo(overrides));
  },

  user(overrides: Partial<UserSeed> = {}): UserSeed {
    return {
      email: uniqueEmail('qa'),
      // Not a real credential: a syntactically valid throwaway for fixture
      // accounts created and destroyed inside a single run.
      password: `Pw!${unique('x')}`,
      firstName: 'QA',
      lastName: runTag(),
      role: 'standard',
      ...overrides,
    };
  },

  address(overrides: Partial<AddressSeed> = {}): AddressSeed {
    return {
      line1: `1 Test Street ${runTag()}`,
      city: 'Testville',
      postcode: 'TE5 7ER',
      country: 'GB',
      ...overrides,
    };
  },

  order(overrides: Partial<OrderSeed> = {}): OrderSeed {
    return {
      reference: unique('order').toUpperCase(),
      items: [{ sku: 'SKU-001', quantity: 1 }],
      address: factory.address(),
      ...overrides,
    };
  },
};

export type Factory = typeof factory;
