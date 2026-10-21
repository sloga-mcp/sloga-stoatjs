/**
 * `EventCollection.listUpcoming`: upcoming events across the user's servers.
 *
 * The route is newer than some servers, so the method tells "this server does
 * not have the route" (the framework's default 404, an untyped HTML body) apart
 * from every other failure, which it throws as `apiReq` would: the parsed JSON
 * body, or the raw text when the body is not JSON.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/eventsUpcoming.test.ts
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

// Rocket's default 404 page, as an old server sends it for an unknown route.
const HTML_404 =
  '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>404 Not Found</title></head>\n<body><h1>404: Not Found</h1></body>\n</html>';

const HTML_401 =
  '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>401 Unauthorized</title></head>\n<body><h1>401: Unauthorized</h1></body>\n</html>';

type Call = { url: string; method: string; body: string | undefined };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Replace `fetch` with a recorder that answers every request with `status`
 * and `text` sent verbatim under `contentType`.
 */
function stubFetchRaw(
  status: number,
  text: string,
  contentType = "text/html; charset=utf-8",
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return new Response(text, {
      status,
      headers: { "Content-Type": contentType },
    });
  }) as typeof fetch;
  return calls;
}

/**
 * Replace `fetch` with a recorder that answers every request with `status`
 * and `payload` as JSON.
 */
function stubFetch(status: number, payload: unknown): Call[] {
  return stubFetchRaw(status, JSON.stringify(payload), "application/json");
}

function makeClient() {
  return new Client({ autoReconnect: false, baseURL: BASE }, CONFIG as never);
}

/**
 * Await `promise`, require it to reject, and require the rejection value to
 * deep-equal `expected` (the whole value, not a subset of its properties).
 */
async function rejectsWith(promise: Promise<unknown>, expected: unknown) {
  let thrown: { value: unknown } | undefined;
  try {
    await promise;
  } catch (error) {
    thrown = { value: error };
  }
  assert.ok(thrown, "expected the call to throw");
  assert.deepEqual(thrown.value, expected);
}

function eventData(id: string, title: string, start: number) {
  return {
    _id: id,
    server: "01SERVER0000000000000000A1",
    channel: "01CHANNEL000000000000000A1",
    creator: "01USER000000000000000000A1",
    title,
    start,
    all_day: false,
    timezone: "UTC",
    cancelled: false,
    created_at: 1_000,
  };
}

test("listUpcoming GETs /events/@me/upcoming with from, to and limit", async () => {
  const calls = stubFetch(200, []);
  const client = makeClient();

  const result = await client.calendarEvents.listUpcoming(1_000, 2_000, 5);

  assert.deepEqual(result, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(
    calls[0].url,
    `${BASE}/events/@me/upcoming?from=1000&to=2000&limit=5`,
  );
  assert.equal(calls[0].body, undefined);
});

test("listUpcoming leaves limit out of the query when it is not given", async () => {
  const calls = stubFetch(200, []);
  const client = makeClient();

  await client.calendarEvents.listUpcoming(1_000, 2_000);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/events/@me/upcoming?from=1000&to=2000`);
});

test("listUpcoming upserts every event and returns the occurrences as given", async () => {
  const client = makeClient();
  const events = client.calendarEvents;

  // An event already in the collection is refreshed, not duplicated.
  const stale = events.upsert(
    eventData("01EVENT00000000000000000A1", "Old", 10),
  );

  stubFetch(200, [
    {
      event: eventData("01EVENT00000000000000000A1", "Raid night", 1_500),
      occurrences: [1_500],
    },
    {
      event: eventData("01EVENT00000000000000000B2", "Weekly sync", 1_200),
      occurrences: [1_200, 1_800],
    },
  ]);

  const result = await events.listUpcoming(1_000, 2_000, 20);

  assert.ok(result);
  assert.equal(result.length, 2);

  assert.equal(result[0].event, stale);
  assert.equal(result[0].event.$exists, true);
  assert.equal(result[0].event.title, "Raid night");
  assert.equal(result[0].event.startAt, 1_500);
  assert.deepEqual(result[0].occurrences, [1_500]);

  assert.equal(result[1].event.$exists, true);
  assert.equal(result[1].event.id, "01EVENT00000000000000000B2");
  assert.equal(result[1].event.title, "Weekly sync");
  assert.deepEqual(result[1].occurrences, [1_200, 1_800]);

  assert.equal(events.get("01EVENT00000000000000000A1"), result[0].event);
  assert.equal(events.get("01EVENT00000000000000000B2"), result[1].event);
  assert.equal(events.size(), 2);

  // Occurrences are window-scoped and are not stored on the event.
  assert.equal(
    "occurrences" in
      (events.getUnderlyingObject("01EVENT00000000000000000B2") as object),
    false,
  );
});

test("listUpcoming resolves undefined on the untyped HTML 404 of a server without the route", async () => {
  stubFetchRaw(404, HTML_404);
  const client = makeClient();

  const result = await client.calendarEvents.listUpcoming(1_000, 2_000, 20);

  assert.equal(result, undefined);
  assert.equal(client.calendarEvents.size(), 0);
});

test("listUpcoming resolves undefined on the untyped JSON 404 of a server without the route", async () => {
  for (const body of [
    {
      error: {
        code: 404,
        reason: "Not Found",
        description: "The requested resource could not be found.",
      },
    },
    { type: 404 },
  ]) {
    stubFetch(404, body);
    const client = makeClient();

    assert.equal(
      await client.calendarEvents.listUpcoming(1_000, 2_000, 20),
      undefined,
    );
  }
});

test("listUpcoming throws a typed NotFound 404", async () => {
  stubFetch(404, { type: "NotFound" });
  const client = makeClient();

  await rejectsWith(client.calendarEvents.listUpcoming(1_000, 2_000, 20), {
    type: "NotFound",
  });
});

test("listUpcoming throws a 429 with its retry_after body", async () => {
  stubFetch(429, { retry_after: 3 });
  const client = makeClient();

  await rejectsWith(client.calendarEvents.listUpcoming(1_000, 2_000, 20), {
    retry_after: 3,
  });
});

test("listUpcoming throws FeatureDisabled", async () => {
  stubFetch(400, { type: "FeatureDisabled", feature: "events" });
  const client = makeClient();

  await rejectsWith(client.calendarEvents.listUpcoming(1_000, 2_000, 20), {
    type: "FeatureDisabled",
    feature: "events",
  });
});

test("listUpcoming throws the raw text of an HTML 401", async () => {
  stubFetchRaw(401, HTML_401);
  const client = makeClient();

  await rejectsWith(
    client.calendarEvents.listUpcoming(1_000, 2_000, 20),
    HTML_401,
  );
});

test("listForServer still throws the raw text of an HTML 404", async () => {
  const calls = stubFetchRaw(404, HTML_404);
  const client = makeClient();

  await rejectsWith(
    client.calendarEvents.listForServer("01SERVER0000000000000000A1", 1, 2),
    HTML_404,
  );
  assert.equal(
    calls[0].url,
    `${BASE}/events/server/01SERVER0000000000000000A1?from=1&to=2`,
  );
});
