import type { Member as APIMember, MemberCompositeKey } from "stoat-api";

import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

export type HydratedServerMember = {
  id: MemberCompositeKey;
  joinedAt: Date;
  nickname?: string;
  avatar?: File;
  roles: string[];
  timeout?: Date;
  /** False while server-muted (the member may not publish audio or video). */
  canPublish: boolean;
  /** False while server-deafened (the member receives no remote media). */
  canReceive: boolean;
};

export const serverMemberHydration: Hydrate<
  Merge<APIMember>,
  HydratedServerMember
> = {
  keyMapping: {
    _id: "id",
    joined_at: "joinedAt",
    can_publish: "canPublish",
    can_receive: "canReceive",
  },
  functions: {
    id: (member) => member._id,
    joinedAt: (member) => new Date(member.joined_at),
    nickname: (member) => member.nickname!,
    avatar: (member, ctx) => new File(ctx as Client, member.avatar!),
    roles: (member) => member.roles,
    timeout: (member) => new Date(member.timeout!),
    // The API omits both flags while they hold their default (`true`), so
    // absent must read as "not muted" — never as `undefined`, which a
    // `!member.canPublish` check would render as a mute badge on everyone.
    canPublish: (member) => member.can_publish ?? true,
    canReceive: (member) => member.can_receive ?? true,
  },
  initialHydration: () => ({
    roles: [],
    canPublish: true,
    canReceive: true,
  }),
};
