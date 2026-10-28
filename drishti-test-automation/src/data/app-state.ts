/**
 * Seed application state directly, without driving the UI.
 *
 * Clicking through fifteen steps to reach the screen you actually want to
 * test is slow, and it makes every one of those fifteen steps a reason for
 * the test to fail for something it is not about. Put the app into the state
 * you need, then test the one thing.
 *
 * Use the UI only when the act of getting there *is* the thing under test.
 */
import type { BrowserContext, Cookie, Page } from '@playwright/test';

export class AppState {
  constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
  ) {}

  /**
   * Set a localStorage key *before the application boots*.
   *
   * This is the correct order for client-rendered apps that read storage
   * once on startup: setting it after navigation means the app has already
   * read the empty value and you need a reload. Call this before `goto`.
   */
  async presetLocalStorage(key: string, value: unknown): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.page.addInitScript(
      ([k, v]) => {
        try {
          window.localStorage.setItem(k, v);
        } catch {
          /* private mode / blocked storage — the test will surface it */
        }
      },
      [key, serialized] as const,
    );
  }

  /** Same, for sessionStorage. */
  async presetSessionStorage(key: string, value: unknown): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.page.addInitScript(
      ([k, v]) => {
        try {
          window.sessionStorage.setItem(k, v);
        } catch {
          /* ignore */
        }
      },
      [key, serialized] as const,
    );
  }

  /**
   * Set a key on an already-loaded page and reload so the app re-reads it.
   * Prefer `presetLocalStorage` when you can still control the navigation.
   */
  async setLocalStorageAndReload(key: string, value: unknown): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      [key, serialized] as const,
    );
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async readLocalStorage<T = unknown>(key: string): Promise<T | undefined> {
    const raw = await this.page.evaluate((k) => window.localStorage.getItem(k), key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  /** Add cookies — session tokens, consent banners, A/B bucket pinning. */
  async setCookies(cookies: Parameters<BrowserContext['addCookies']>[0]): Promise<void> {
    await this.context.addCookies(cookies);
  }

  async cookies(): Promise<Cookie[]> {
    return this.context.cookies();
  }

  /**
   * Pin a feature flag carried in a cookie. Common enough to be worth a
   * helper: it keeps the flag name visible in the test rather than buried in
   * a cookie literal.
   */
  async setFlagCookie(name: string, value: string, url: string): Promise<void> {
    const { hostname } = new URL(url);
    await this.context.addCookies([{ name, value, domain: hostname, path: '/' }]);
  }

  /** Wipe storage between phases of a long test. */
  async clearStorage(): Promise<void> {
    await this.page.evaluate(() => {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await this.context.clearCookies();
  }

  /**
   * Stub a backend response for the current page.
   *
   * Use sparingly and deliberately: a stubbed E2E test no longer proves the
   * integration works. It is the right tool for states a real backend cannot
   * easily produce — a 500, a timeout, an empty result set, a rate limit.
   */
  async stub(
    urlPattern: string | RegExp,
    response: { status?: number; json?: unknown; body?: string; headers?: Record<string, string> },
  ): Promise<void> {
    await this.page.route(urlPattern, async (route) => {
      await route.fulfill({
        status: response.status ?? 200,
        contentType: response.json !== undefined ? 'application/json' : 'text/plain',
        body: response.json !== undefined ? JSON.stringify(response.json) : (response.body ?? ''),
        headers: response.headers,
      });
    });
  }

  /** Simulate a failed request — the network condition tests usually skip. */
  async failRequests(urlPattern: string | RegExp, errorCode = 'failed'): Promise<void> {
    await this.page.route(urlPattern, (route) => route.abort(errorCode as never));
  }
}

/* ------------------------------------------------- app-specific adapters */

import type { TodoSeed } from './factory.js';

/**
 * TodoMVC keeps its list in `localStorage` under `react-todos`. Seeding it
 * directly turns "add three todos" from nine UI interactions into zero.
 *
 * This is the shape every app-specific seeder should take: one small function
 * that knows one storage contract, kept beside the generic helpers rather
 * than leaking into tests.
 */
export async function seedTodos(state: AppState, todos: TodoSeed[]): Promise<void> {
  await state.presetLocalStorage(
    'react-todos',
    todos.map((t) => ({ id: t.id, title: t.title, completed: t.completed })),
  );
}
