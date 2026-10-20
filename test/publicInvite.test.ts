/**
 * `ServerPublicInvite` carries the server description and online count.
 *
 * Both are newer than the published stoat-api types and the API omits them
 * for servers that are not publicly discoverable, so these cases pin that
 * they are read when present and stay undefined (never 0 or "") when absent.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/publicInvite.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSrc } from "./loadSrc.ts";

type InviteModule = typeof import("../src/classes/PublicInvite.ts");
type Client = import("../src/Client.ts").Client;

const { PublicChannelInvite, ServerPublicInvite } = await loadSrc<InviteModule>(
  "classes/PublicInvite.ts",
);

// No icon, banner or avatar, so nothing reads the client.
const client = {} as Client;

const BASE = {
  type: "Server" as const,
  code: "abcdefgh",
  server_id: "01K6E000000000000000000001",
  server_name: "Test",
  channel_id: "01K6E000000000000000000002",
  channel_name: "general",
  user_name: "owner",
  member_count: 12,
};

test("reads the description and online count when the API sends them", () => {
  const invite = PublicChannelInvite.from(client, {
    ...BASE,
    server_description: "About us",
    online_count: 3,
  } as never);

  assert.ok(invite instanceof ServerPublicInvite);
  assert.equal(invite.serverDescription, "About us");
  assert.equal(invite.onlineCount, 3);
  assert.equal(invite.memberCount, 12);
});

test("keeps an online count of zero", () => {
  const invite = new ServerPublicInvite(client, {
    ...BASE,
    online_count: 0,
  });

  assert.equal(invite.onlineCount, 0);
});

test("leaves both undefined when the API omits them", () => {
  const invite = new ServerPublicInvite(client, BASE);

  assert.equal(invite.serverDescription, undefined);
  assert.equal(invite.onlineCount, undefined);
});
