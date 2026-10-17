/**
 * `fetchImportChallenge` and `importServer`: the non-Discord import routes.
 *
 * These routes are newer than the generated `stoat-api` tables, so they go
 * through the raw-fetch helper. The typed client would send an empty `{}` body
 * for a route missing from its tables, which is exactly the silent failure
 * these cases pin: each one checks the method, the path the source lands in,
 * the exact body, and that an error body is rethrown parsed.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/importSources.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control exported from an older commit, set `STOATJS_SRC` (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");

const { Client } = await loadSrc<ClientModule>("Client.ts");

// Passing a configuration stops the constructor fetching `/` for one
const CONFIG = {
  revolt: "test",
  features: {
    autumn: { enabled: false, url: "" },
    january: { enabled: false, url: "" },
  },
  ws: "ws://127.0.0.1:9",
  app: "",
  vapid: "",
  build: {},
};

const BASE = "http://api.test";

type Call = { url: string; method: string; body: string | undefined };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Replace `fetch` with a recorder that answers every request with `status`
 * and `payload`.
 */
function stubFetch(status: number, payload: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

function makeClient() {
  return new Client({ autoReconnect: false, baseURL: BASE }, CONFIG as never);
}

test("fetchImportChallenge GETs /import/{source}/challenge with no body", async () => {
  const calls = stubFetch(200, { code: "sloga-1a2b3c" });
  const client = makeClient();

  const result = await client.fetchImportChallenge("stoat");

  assert.deepEqual(result, { code: "sloga-1a2b3c" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, `${BASE}/import/stoat/challenge`);
  assert.equal(calls[0].body, undefined);
});

test("fetchImportChallenge rethrows the parsed error body", async () => {
  stubFetch(404, { type: "ImportSourceNotFound" });
  const client = makeClient();

  await assert.rejects(client.fetchImportChallenge("matrix"), {
    type: "ImportSourceNotFound",
  });
});

test("importServer POSTs { source } to /import/{source}/server", async () => {
  const calls = stubFetch(200, { job_id: "01K6A000000000000000000001" });
  const client = makeClient();

  const result = await client.importServer(
    "fluxer",
    "https://example.test/invite/abc",
  );

  assert.deepEqual(result, { job_id: "01K6A000000000000000000001" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/import/fluxer/server`);
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    source: "https://example.test/invite/abc",
  });
});

test("importServer rethrows the parsed error body", async () => {
  stubFetch(400, { type: "ImportVerificationMissing" });
  const client = makeClient();

  await assert.rejects(client.importServer("stoat", "01K6A0"), {
    type: "ImportVerificationMissing",
  });
});
