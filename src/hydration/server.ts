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
};

export const serverHydration: Hydrate<
  // `discovery_requested` / `voice_region` are additive; stoat-api predates them.
  APIServer & { discovery_requested?: boolean; voice_region?: string },
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
  },
  initialHydration: () => ({
    channelIds: new ReactiveSet(),
    roles: new ReactiveMap(),
    voiceRegion: undefined,
  }),
};

/**
 * Flags attributed to servers
 */
export enum ServerFlags {
  Official = 1,
  Verified = 2,
}
