import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";
import type {
  Server as APIServer,
  Category,
  SystemMessageChannels,
} from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import { ServerRole } from "../classes/ServerRole.js";

import type { Hydrate } from "./index.js";

export type HydratedServer = {
  id: string;
  ownerId: string;

  name: string;
  description?: string;

  icon?: File;
  banner?: File;

  channelIds: ReactiveSet<string>;
  categories?: Category[];

  systemMessages?: SystemMessageChannels;
  roles: ReactiveMap<string, ServerRole>;
  defaultPermissions: bigint;

  flags: ServerFlags;
  analytics: boolean;
  discoverable: boolean;
  discoveryRequested: boolean;
  nsfw: boolean;
  /** Preferred voice node name; `undefined` = automatic (lowest latency) */
  voiceRegion?: string;
  /** Id of this server's AFK voice channel; `undefined` = none designated */
  afkChannelId?: string;
  /** Idle timeout in SECONDS before a member is moved to the AFK channel */
  afkTimeout?: number;
};

export const serverHydration: Hydrate<
  // `discovery_requested` / `voice_region` / `afk_channel_id` / `afk_timeout`
  // are additive; stoat-api predates them.
  APIServer & {
    discovery_requested?: boolean;
    voice_region?: string;
    afk_channel_id?: string | null;
    afk_timeout?: number | null;
  },
  HydratedServer
> = {
  keyMapping: {
    _id: "id",
    owner: "ownerId",
    channels: "channelIds",
    system_messages: "systemMessages",
    default_permissions: "defaultPermissions",
    discovery_requested: "discoveryRequested",
    voice_region: "voiceRegion",
    afk_channel_id: "afkChannelId",
    afk_timeout: "afkTimeout",
  },
  functions: {
    id: (server) => server._id,
    ownerId: (server) => server.owner,
    name: (server) => server.name,
    description: (server) => server.description!,
    channelIds: (server) => new ReactiveSet(server.channels),
    categories: (server) => server.categories ?? [],
    systemMessages: (server) => server.system_messages ?? {},
    roles: (server, ctx) =>
      new ReactiveMap(
        Object.keys(server.roles!).map((id) => [
          id,
          new ServerRole(ctx as Client, server._id, id, server.roles![id]),
        ]),
      ),
    defaultPermissions: (server) => BigInt(server.default_permissions),
    icon: (server, ctx) => new File(ctx as Client, server.icon!),
    banner: (server, ctx) => new File(ctx as Client, server.banner!),
    flags: (server) => server.flags!,
    analytics: (server) => server.analytics || false,
    discoverable: (server) => server.discoverable || false,
    discoveryRequested: (server) => server.discovery_requested || false,
    nsfw: (server) => server.nsfw || false,
    voiceRegion: (server) => server.voice_region ?? undefined,
    afkChannelId: (server) => server.afk_channel_id ?? undefined,
    afkTimeout: (server) => server.afk_timeout ?? undefined,
  },
  initialHydration: () => ({
    channelIds: new ReactiveSet(),
    roles: new ReactiveMap(),
    voiceRegion: undefined,
    afkChannelId: undefined,
    afkTimeout: undefined,
  }),
};

/**
 * Flags attributed to servers
 */
export enum ServerFlags {
  Official = 1,
  Verified = 2,
}
