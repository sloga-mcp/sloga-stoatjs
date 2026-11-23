/**
 * Passkeys: the MFA ticket methods, the raw routes and passkey sign-in.
 *
 * - `availableMfaMethods` (and `MFA.availableMethods` on top of it): a status
 *   from a server that predates passkeys gives the lists it always gave;
 *   `security_key_mfa` puts `"Passkey"` first; `password_absent` drops
 *   `"Password"`.
 * - `MFA.createTicket` sends a `passkey_response` factor as given.
 * - `client.passkeys.*` go through the raw-fetch helper (the routes are newer
 *   than the generated `stoat-api` tables, whose typed client would send an
 *   empty `{}` body): each case checks the method, the path, the exact body
 *   and the `X-MFA-Ticket` header, present or absent. The ticket goes with
 *   `registerFinish` (optional) and `remove`; `registerStart` and `rename`
 *   never send one.
 * - `account.changeEmail`, `account.changePassword` and `user.changeUsername`
 *   send what they always sent when given a password, and for an account
 *   with no password leave the password key out and send the ticket header.
 * - `passkeyLoginFinish` keeps a session the way `login` does, returns a
 *   disabled account without keeping one, and throws on any other reply.
 * - `options` and `credential` cross the SDK untouched, key for key.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/passkeys.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control exported from an older commit, set `STOATJS_SRC` (see loadSrc.ts).
 * New modules are loaded inside the cases that need them, so an older tree
 * fails case by case instead of at import.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type ClientModule = typeof import("../src/Client.ts");
type MFAModule = typeof import("../src/classes/MFA.ts");
type MethodsModule = typeof import("../src/lib/mfaMethods.ts");

const { Client } = await loadSrc<ClientModule>("Client.ts");
const { MFA } = await loadSrc<MFAModule>("classes/MFA.ts");

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
const USER = "01K8P000000000000000000001";
const SESSION = "01K8P000000000000000000002";
const PASSKEY = "01K8P000000000000000000003";
const CHALLENGE = "01K8P000000000000000000004";

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function headerRecord(headers: unknown): Record<string, string> {
  if (!headers) return {};
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Object.entries(headers as Record<string, string>);
  return Object.fromEntries(
    entries.map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
}

/**
 * Replace `fetch` with a recorder that answers every request with `status`
 * and `payload` (no body at all for a 204).
 */
function stubFetch(status: number, payload?: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method ?? "GET").toUpperCase(),
      headers: headerRecord(init?.headers),
      body: init?.body as string | undefined,
    });
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        });
  }) as typeof fetch;
  return calls;
}

function makeClient() {
  return new Client({ autoReconnect: false, baseURL: BASE }, CONFIG as never);
}

/** A signed-in client: raw requests carry its session token. */
function makeSessionClient() {
  const client = makeClient();
  client.useExistingSession({ _id: SESSION, token: "tok", user_id: USER });
  return client;
}

/** A status as a server that predates passkeys sends it. */
function oldStatus(totp: boolean, recovery: boolean) {
  return {
    email_otp: false,
    trusted_handover: false,
    email_mfa: false,
    totp_mfa: totp,
    recovery_active: recovery,
  };
}

// Stand-ins for the opaque WebAuthn JSON. They carry `extensions` and
// `clientExtensionResults` on purpose: the SDK must not add, drop or rewrite
// any key, those included (stripping them is the native layer's job).
const OPTIONS = {
  challenge: "Y2hhbGxlbmdl",
  rpId: "app.example.test",
  userVerification: "required",
  extensions: { credProps: true },
};
const CREDENTIAL = {
  id: "Y3JlZA",
  rawId: "Y3JlZA",
  type: "public-key",
  response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" },
  clientExtensionResults: {},
};
const INFO = {
  id: PASSKEY,
  name: "Phone",
  created_at: "2026-11-22T10:00:00Z",
};

// ---- availableMfaMethods ---------------------------------------------------

test("a status without the passkey fields gives the lists it always gave", async () => {
  const { availableMfaMethods } =
    await loadSrc<MethodsModule>("lib/mfaMethods.ts");

  assert.deepEqual(availableMfaMethods(oldStatus(false, false)), ["Password"]);
  // Recovery codes without an authenticator were never offered
  assert.deepEqual(availableMfaMethods(oldStatus(false, true)), ["Password"]);
  assert.deepEqual(availableMfaMethods(oldStatus(true, false)), ["Totp"]);
  assert.deepEqual(availableMfaMethods(oldStatus(true, true)), [
    "Totp",
    "Recovery",
  ]);
});

test("explicit false passkey fields change nothing", async () => {
  const { availableMfaMethods } =
    await loadSrc<MethodsModule>("lib/mfaMethods.ts");
  const off = { security_key_mfa: false, password_absent: false };

  assert.deepEqual(
    availableMfaMethods({ ...oldStatus(false, false), ...off }),
    ["Password"],
  );
  assert.deepEqual(availableMfaMethods({ ...oldStatus(true, true), ...off }), [
    "Totp",
    "Recovery",
  ]);
});

test("security_key_mfa puts Passkey first", async () => {
  const { availableMfaMethods } =
    await loadSrc<MethodsModule>("lib/mfaMethods.ts");
  const on = { security_key_mfa: true };

  assert.deepEqual(availableMfaMethods({ ...oldStatus(false, false), ...on }), [
    "Passkey",
    "Password",
  ]);
  assert.deepEqual(availableMfaMethods({ ...oldStatus(true, false), ...on }), [
    "Passkey",
    "Totp",
  ]);
  assert.deepEqual(availableMfaMethods({ ...oldStatus(true, true), ...on }), [
    "Passkey",
    "Totp",
    "Recovery",
  ]);
});

test("password_absent drops Password and nothing else", async () => {
  const { availableMfaMethods } =
    await loadSrc<MethodsModule>("lib/mfaMethods.ts");
  const absent = { password_absent: true };

  assert.deepEqual(
    availableMfaMethods({ ...oldStatus(false, false), ...absent }),
    [],
  );
  assert.deepEqual(
    availableMfaMethods({ ...oldStatus(true, true), ...absent }),
    ["Totp", "Recovery"],
  );
});

test("security_key_mfa with password_absent leaves Passkey alone, or first", async () => {
  const { availableMfaMethods } =
    await loadSrc<MethodsModule>("lib/mfaMethods.ts");
  const both = { security_key_mfa: true, password_absent: true };

  assert.deepEqual(
    availableMfaMethods({ ...oldStatus(false, false), ...both }),
    ["Passkey"],
  );
  assert.deepEqual(
    availableMfaMethods({ ...oldStatus(true, false), ...both }),
    ["Passkey", "Totp"],
  );
});

test("a non-boolean passkey field is not read as set", async () => {
  const { availableMfaMethods } =
    await loadSrc<MethodsModule>("lib/mfaMethods.ts");

  assert.deepEqual(
    availableMfaMethods({
      ...oldStatus(false, false),
      security_key_mfa: "yes",
      password_absent: 1,
    } as never),
    ["Password"],
  );
});

// ---- MFA -------------------------------------------------------------------

test("MFA.availableMethods follows the status it was built from", () => {
  const client = makeClient();

  assert.deepEqual(
    new MFA(client, oldStatus(false, false) as never).availableMethods,
    ["Password"],
  );
  assert.deepEqual(
    new MFA(client, oldStatus(true, true) as never).availableMethods,
    ["Totp", "Recovery"],
  );

  const passkeyOnly = new MFA(client, {
    ...oldStatus(false, false),
    security_key_mfa: true,
    password_absent: true,
  } as never);
  assert.deepEqual(passkeyOnly.availableMethods, ["Passkey"]);
  assert.equal(passkeyOnly.passkeyEnabled, true);
  assert.equal(passkeyOnly.passwordAbsent, true);

  const old = new MFA(client, oldStatus(false, false) as never);
  assert.equal(old.passkeyEnabled, false);
  assert.equal(old.passwordAbsent, false);
});

test("MFA.createTicket sends a passkey_response factor as given", async () => {
  const calls = stubFetch(200, {
    _id: "t",
    account_id: USER,
    token: "ticket-token",
    validated: true,
    authorised: false,
  });
  const client = makeSessionClient();
  const mfa = new MFA(client, {
    ...oldStatus(false, false),
    security_key_mfa: true,
  } as never);

  const ticket = await mfa.createTicket({
    passkey_response: { challenge_id: CHALLENGE, credential: CREDENTIAL },
  } as never);

  assert.equal(ticket.token, "ticket-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.equal(new URL(calls[0].url).pathname, "/auth/mfa/ticket");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    passkey_response: { challenge_id: CHALLENGE, credential: CREDENTIAL },
  });
});

test("MFA.createTicket still sends a password factor as before", async () => {
  const calls = stubFetch(200, {
    _id: "t",
    account_id: USER,
    token: "ticket-token",
    validated: true,
    authorised: false,
  });
  const mfa = new MFA(makeSessionClient(), oldStatus(false, false) as never);

  await mfa.createTicket({ password: "hunter2" });

  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    password: "hunter2",
  });
});

// ---- client.passkeys -------------------------------------------------------

test("passkeys.list GETs /auth/passkey with the session and no body", async () => {
  const calls = stubFetch(200, [INFO]);
  const client = makeSessionClient();

  const result = await client.passkeys.list();

  assert.deepEqual(result, [INFO]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, `${BASE}/auth/passkey`);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers["x-session-token"], "tok");
  assert.equal(calls[0].headers["x-mfa-ticket"], undefined);
});

test("passkeys.registerStart POSTs with the session, no body and no ticket header", async () => {
  const calls = stubFetch(200, { challenge_id: CHALLENGE, options: OPTIONS });
  const client = makeSessionClient();

  const result = await client.passkeys.registerStart();

  assert.deepEqual(result, { challenge_id: CHALLENGE, options: OPTIONS });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/register/start`);
  assert.equal(calls[0].body, undefined);
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
  assert.equal(calls[0].headers["x-session-token"], "tok");
});

test("passkeys.registerStart sends no ticket header even when handed one", async () => {
  const calls = stubFetch(200, { challenge_id: CHALLENGE, options: OPTIONS });
  const client = makeSessionClient();

  // It takes no parameter; a caller written against the older signature
  // must not get its ticket sent here (the server would ignore it).
  await (
    client.passkeys.registerStart as unknown as (
      ticket: string,
    ) => Promise<unknown>
  )("ticket-token");

  assert.equal(calls.length, 1);
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
});

test("passkeys.registerFinish sends the ticket header when given one", async () => {
  const calls = stubFetch(200, INFO);
  const client = makeSessionClient();

  const result = await client.passkeys.registerFinish(
    CHALLENGE,
    CREDENTIAL,
    "Phone",
    "ticket-token",
  );

  assert.deepEqual(result, INFO);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/register/finish`);
  assert.equal(calls[0].headers["content-type"], "application/json");
  assert.equal(calls[0].headers["x-mfa-ticket"], "ticket-token");
  assert.equal(calls[0].headers["x-session-token"], "tok");
  // The ticket travels in the header only
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    challenge_id: CHALLENGE,
    credential: CREDENTIAL,
    name: "Phone",
  });
});

test("passkeys.registerFinish leaves the ticket header out without one", async () => {
  const calls = stubFetch(200, INFO);
  const client = makeSessionClient();

  const result = await client.passkeys.registerFinish(
    CHALLENGE,
    CREDENTIAL,
    "Phone",
  );

  assert.deepEqual(result, INFO);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/register/finish`);
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
  assert.equal(calls[0].headers["x-session-token"], "tok");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    challenge_id: CHALLENGE,
    credential: CREDENTIAL,
    name: "Phone",
  });
});

test("passkeys.registerFinish leaves name out when not given", async () => {
  const calls = stubFetch(200, INFO);
  const client = makeSessionClient();

  await client.passkeys.registerFinish(CHALLENGE, CREDENTIAL);

  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    challenge_id: CHALLENGE,
    credential: CREDENTIAL,
  });
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
});

test("passkeys.registerFinish takes a ticket without a name", async () => {
  const calls = stubFetch(200, INFO);
  const client = makeSessionClient();

  await client.passkeys.registerFinish(
    CHALLENGE,
    CREDENTIAL,
    undefined,
    "ticket-token",
  );

  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    challenge_id: CHALLENGE,
    credential: CREDENTIAL,
  });
  assert.equal(calls[0].headers["x-mfa-ticket"], "ticket-token");
});

test("passkeys.rename PATCHes { name } with no ticket header", async () => {
  const calls = stubFetch(200, { ...INFO, name: "Laptop" });
  const client = makeSessionClient();

  const result = await client.passkeys.rename(PASSKEY, "Laptop");

  assert.deepEqual(result, { ...INFO, name: "Laptop" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/${PASSKEY}`);
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
  assert.equal(calls[0].headers["x-session-token"], "tok");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), { name: "Laptop" });
});

test("passkeys.rename sends no ticket header even when handed one", async () => {
  const calls = stubFetch(200, { ...INFO, name: "Laptop" });
  const client = makeSessionClient();

  await (
    client.passkeys.rename as unknown as (
      id: string,
      name: string,
      ticket: string,
    ) => Promise<unknown>
  )(PASSKEY, "Laptop", "ticket-token");

  assert.equal(calls.length, 1);
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), { name: "Laptop" });
});

test("passkeys.remove DELETEs with the ticket header and takes a 204", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  const result = await client.passkeys.remove(PASSKEY, "ticket-token");

  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/${PASSKEY}`);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers["x-mfa-ticket"], "ticket-token");
});

test("a passkey id cannot reach another route", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  await client.passkeys.remove("../account/delete?x=1", "ticket-token");

  assert.equal(
    calls[0].url,
    `${BASE}/auth/passkey/..%2Faccount%2Fdelete%3Fx%3D1`,
  );
});

test("passkeys.assertStart POSTs /auth/passkey/assert/start with no body", async () => {
  const calls = stubFetch(200, { challenge_id: CHALLENGE, options: OPTIONS });
  const client = makeSessionClient();

  const result = await client.passkeys.assertStart();

  assert.deepEqual(result, { challenge_id: CHALLENGE, options: OPTIONS });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/assert/start`);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers["x-session-token"], "tok");
});

test("passkeys.* rethrow the parsed error body", async () => {
  stubFetch(403, { type: "InvalidToken" });
  const client = makeSessionClient();

  await assert.rejects(client.passkeys.list(), { type: "InvalidToken" });
  await assert.rejects(client.passkeys.registerStart(), {
    type: "InvalidToken",
  });
  await assert.rejects(client.passkeys.rename(PASSKEY, "x"), {
    type: "InvalidToken",
  });
  await assert.rejects(client.passkeys.remove(PASSKEY, "bad"), {
    type: "InvalidToken",
  });
});

test("passkeys.registerFinish without a ticket rethrows NotPrivileged", async () => {
  stubFetch(403, { type: "NotPrivileged" });
  const client = makeSessionClient();

  await assert.rejects(client.passkeys.registerFinish(CHALLENGE, CREDENTIAL), {
    type: "NotPrivileged",
  });
});

// ---- account changes -------------------------------------------------------

function makeUserClient() {
  const client = makeSessionClient();
  client.user = client.users.getOrCreate(USER, {
    _id: USER,
    username: "me",
    discriminator: "0001",
    relationship: "User",
    online: true,
  } as never);
  return client;
}

test("account.changeEmail with a password sends what it always sent", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  await client.account.changeEmail("new@example.test", "hunter2");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/auth/account/change/email");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
  assert.equal(calls[0].headers["x-session-token"], "tok");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    email: "new@example.test",
    current_password: "hunter2",
  });
});

test("account.changeEmail without a password leaves the key out and sends the ticket", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  await client.account.changeEmail(
    "new@example.test",
    undefined,
    "ticket-token",
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/auth/account/change/email");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal(calls[0].headers["x-mfa-ticket"], "ticket-token");
  assert.equal(calls[0].headers["x-session-token"], "tok");
  const body = JSON.parse(calls[0].body ?? "null");
  assert.equal("current_password" in body, false);
  assert.deepEqual(body, { email: "new@example.test" });
});

test("account.changeEmail sends a password and a ticket together when given both", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  await client.account.changeEmail(
    "new@example.test",
    "hunter2",
    "ticket-token",
  );

  assert.equal(calls[0].headers["x-mfa-ticket"], "ticket-token");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    email: "new@example.test",
    current_password: "hunter2",
  });
});

test("account.changePassword with a password sends what it always sent", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  await client.account.changePassword("correct horse", "hunter2");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/auth/account/change/password");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
  assert.equal(calls[0].headers["x-session-token"], "tok");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    password: "correct horse",
    current_password: "hunter2",
  });
});

test("account.changePassword without a password leaves the key out and sends the ticket", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  await client.account.changePassword(
    "correct horse",
    undefined,
    "ticket-token",
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/auth/account/change/password");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal(calls[0].headers["x-mfa-ticket"], "ticket-token");
  assert.equal(calls[0].headers["x-session-token"], "tok");
  const body = JSON.parse(calls[0].body ?? "null");
  assert.equal("current_password" in body, false);
  assert.deepEqual(body, { password: "correct horse" });
});

test("user.changeUsername with a password sends what it always sent", async () => {
  const calls = stubFetch(200, { _id: USER, username: "renamed" });
  const client = makeUserClient();

  const result = await client.user!.changeUsername("renamed", "hunter2");

  assert.deepEqual(result, { _id: USER, username: "renamed" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/users/@me/username");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal("x-mfa-ticket" in calls[0].headers, false);
  assert.equal(calls[0].headers["x-session-token"], "tok");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    username: "renamed",
    password: "hunter2",
  });
});

test("user.changeUsername without a password leaves the key out and sends the ticket", async () => {
  const calls = stubFetch(200, { _id: USER, username: "renamed" });
  const client = makeUserClient();

  await client.user!.changeUsername("renamed", undefined, "ticket-token");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/users/@me/username");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal(calls[0].headers["x-mfa-ticket"], "ticket-token");
  assert.equal(calls[0].headers["x-session-token"], "tok");
  const body = JSON.parse(calls[0].body ?? "null");
  assert.equal("password" in body, false);
  assert.deepEqual(body, { username: "renamed" });
});

test("an empty password is still sent, not treated as missing", async () => {
  const calls = stubFetch(204);
  const client = makeSessionClient();

  await client.account.changeEmail("new@example.test", "");

  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    email: "new@example.test",
    current_password: "",
  });
});

// ---- sign-in ---------------------------------------------------------------

const SUCCESS = {
  result: "Success",
  _id: SESSION,
  user_id: USER,
  token: "session-token",
  name: "Phone",
  last_seen: "2026-11-22T10:00:00Z",
};

test("passkeyLoginStart POSTs with no session header and no body", async () => {
  const calls = stubFetch(200, { challenge_id: CHALLENGE, options: OPTIONS });
  const client = makeClient();

  const result = await client.passkeyLoginStart();

  assert.deepEqual(result, { challenge_id: CHALLENGE, options: OPTIONS });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/login/start`);
  assert.equal(calls[0].body, undefined);
  assert.equal("x-session-token" in calls[0].headers, false);
});

test("passkeyLoginFinish keeps and returns the session", async () => {
  const calls = stubFetch(200, SUCCESS);
  const client = makeClient();
  assert.equal(client.sessionId, undefined);

  const result = await client.passkeyLoginFinish(
    CHALLENGE,
    CREDENTIAL,
    "Phone",
  );

  assert.deepEqual(result, SUCCESS);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/auth/passkey/login/finish`);
  assert.equal("x-session-token" in calls[0].headers, false);
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    challenge_id: CHALLENGE,
    credential: CREDENTIAL,
    friendly_name: "Phone",
  });
  assert.equal(client.sessionId, SESSION);
  assert.deepEqual(client.authenticationHeader, [
    "X-Session-Token",
    "session-token",
  ]);
});

test("passkeyLoginFinish leaves friendly_name out when not given", async () => {
  const calls = stubFetch(200, SUCCESS);

  await makeClient().passkeyLoginFinish(CHALLENGE, CREDENTIAL);

  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
    challenge_id: CHALLENGE,
    credential: CREDENTIAL,
  });
});

test("passkeyLoginFinish returns a disabled account and keeps no session", async () => {
  const disabled = {
    result: "Disabled",
    user_id: USER,
    suspended_until: "2026-12-01T00:00:00Z",
  };
  stubFetch(200, disabled);
  const client = makeClient();

  const result = await client.passkeyLoginFinish(CHALLENGE, CREDENTIAL);

  assert.deepEqual(result, disabled);
  assert.equal(client.sessionId, undefined);
});

test("passkeyLoginFinish throws on an MFA step and keeps no session", async () => {
  stubFetch(200, { result: "MFA", ticket: "t", allowed_methods: ["Totp"] });
  const client = makeClient();

  await assert.rejects(
    client.passkeyLoginFinish(CHALLENGE, CREDENTIAL),
    /Unexpected reply/,
  );
  assert.equal(client.sessionId, undefined);
});

test("passkeyLoginFinish throws on a session reply with no token", async () => {
  stubFetch(200, { result: "Success", _id: SESSION, user_id: USER });
  const client = makeClient();

  await assert.rejects(
    client.passkeyLoginFinish(CHALLENGE, CREDENTIAL),
    /Unexpected reply/,
  );
  assert.equal(client.sessionId, undefined);
});

test("passkeyLoginFinish rethrows the parsed error body", async () => {
  stubFetch(401, { type: "InvalidCredentials" });
  const client = makeClient();

  await assert.rejects(client.passkeyLoginFinish(CHALLENGE, CREDENTIAL), {
    type: "InvalidCredentials",
  });
  assert.equal(client.sessionId, undefined);
});

// ---- password sign-in, which shares the session step -------------------------

test("login keeps the session of a Success reply, as before", async () => {
  const calls = stubFetch(200, SUCCESS);
  const client = makeClient();

  await client.login({ email: "a@example.test", password: "hunter2" });

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/auth/session/login");
  assert.equal(client.sessionId, SESSION);
});

test("login still throws on an MFA reply and keeps no session", async () => {
  stubFetch(200, { result: "MFA", ticket: "t", allowed_methods: ["Totp"] });
  const client = makeClient();

  await assert.rejects(
    client.login({ email: "a@example.test", password: "hunter2" }),
    (error) => error === "MFA not implemented!",
  );
  assert.equal(client.sessionId, undefined);
});
