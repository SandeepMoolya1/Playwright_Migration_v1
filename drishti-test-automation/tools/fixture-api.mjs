#!/usr/bin/env node
/**
 * Bundled fixture API.
 *
 * A tiny REST server so the framework's own API-seeding path is exercised for
 * real rather than described. It backs the `local` environment's `apiURL`, and
 * exists only for this repository's self-tests — when you point the framework
 * at your own application, replace `local.apiURL` in `config/environments.ts`
 * with your real API and delete this file.
 *
 * Deliberately dependency-free (`node:http`) and in-memory: it starts in
 * milliseconds and leaves nothing behind.
 *
 * Routes
 *   POST   /todos           create      -> 201 { id, title, completed, createdAt }
 *   GET    /todos           list        -> 200 [ ... ]
 *   GET    /todos/:id       read        -> 200 | 404
 *   PATCH  /todos/:id       update      -> 200 | 404
 *   DELETE /todos/:id       delete      -> 204 | 404
 *   GET    /_audit          what happened, in order (test introspection)
 *   POST   /_reset          clear everything
 *   GET    /_health         readiness probe used by Playwright's webServer
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.FIXTURE_API_PORT ?? 4010);
const HOST = '127.0.0.1';

/** resource -> id -> entity */
const store = new Map();
/** Ordered log of mutations, so tests can assert cleanup order. */
const audit = [];

const collection = (resource) => {
  if (!store.has(resource)) store.set(resource, new Map());
  return store.get(resource);
};

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // Refuse anything implausible rather than buffering without limit.
      if (raw.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const method = req.method ?? 'GET';
  const segments = pathname.split('/').filter(Boolean);

  try {
    if (pathname === '/_health') return send(res, 200, { ok: true });

    if (pathname === '/_audit') return send(res, 200, audit);

    if (pathname === '/_reset' && method === 'POST') {
      store.clear();
      audit.length = 0;
      return send(res, 204);
    }

    // Everything else is /{resource} or /{resource}/{id}
    const [resource, id] = segments;
    if (!resource) return send(res, 404, { error: 'not found' });

    const items = collection(resource);

    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const entity = { id: randomUUID(), createdAt: new Date().toISOString(), ...body };
      items.set(entity.id, entity);
      audit.push({ action: 'create', resource, id: entity.id });
      return send(res, 201, entity);
    }

    if (method === 'GET' && !id) {
      return send(res, 200, [...items.values()]);
    }

    if (!id) return send(res, 405, { error: `${method} not allowed on /${resource}` });

    if (method === 'GET') {
      const entity = items.get(id);
      return entity ? send(res, 200, entity) : send(res, 404, { error: 'not found' });
    }

    if (method === 'PATCH') {
      const entity = items.get(id);
      if (!entity) return send(res, 404, { error: 'not found' });
      const body = await readBody(req);
      const updated = { ...entity, ...body };
      items.set(id, updated);
      audit.push({ action: 'update', resource, id });
      return send(res, 200, updated);
    }

    if (method === 'DELETE') {
      if (!items.has(id)) {
        // Record the attempt: the seeder treats 404 on cleanup as success,
        // and a test asserts exactly that.
        audit.push({ action: 'delete-missing', resource, id });
        return send(res, 404, { error: 'not found' });
      }
      items.delete(id);
      audit.push({ action: 'delete', resource, id });
      return send(res, 204);
    }

    return send(res, 405, { error: `${method} not allowed` });
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`fixture-api listening on http://${HOST}:${PORT}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
