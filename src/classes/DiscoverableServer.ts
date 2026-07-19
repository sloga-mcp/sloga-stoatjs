import { batch } from "solid-js";

import type { File as APIFile } from "stoat-api";

import type { Client } from "../Client.js";
import type { ServerFlags } from "../hydration/server.js";

import { File } from "./File.js";
import type { Server } from "./Server.js";

/**
 * Public card returned by the unauthenticated discovery endpoints.
 * Icon/banner are sanitized PublicFile DTOs (no uploader ids) — a
 * compatible subset of the API File shape.
 */
export interface DiscoverableServerData {
  _id: string;
  name: string;
  description?: string;
  icon?: APIFile;
  banner?: APIFile;
  flags?: number;
  member_count: number;
}

/**
 * A server listed in the public discovery directory
 */
export class DiscoverableServer {
  readonly client: Client;

  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: File;
  readonly banner?: File;
  readonly flags: ServerFlags;
  readonly memberCount: number;

  /**
   * Construct from a discovery card
   * @param client Client
   * @param data Card data
   */
  constructor(client: Client, data: DiscoverableServerData) {
    this.client = client;

    this.id = data._id;
    this.name = data.name;
    this.description = data.description;
    this.icon = data.icon ? new File(client, data.icon) : undefined;
    this.banner = data.banner ? new File(client, data.banner) : undefined;
    this.flags = data.flags ?? 0;
    this.memberCount = data.member_count;
  }

  /**
   * Fetch a discoverable server's public card by id.
   * Rejects with the API error object on 404 (not listed / does not exist).
   */
  static async fetch(client: Client, id: string): Promise<DiscoverableServer> {
    // Raw fetch: the typed api package lags behind the fork's routes
    const response = await fetch(
      `${client.options.baseURL}/discover/servers/${id}`,
    );
    if (!response.ok) throw await response.json();

    return new DiscoverableServer(
      client,
      (await response.json()) as DiscoverableServerData,
    );
  }

  /**
   * Server (if we are already a member and it exists in cache)
   */
  get server(): Server | undefined {
    return this.client.servers.get(this.id);
  }

  /**
   * Join this server without an invite (allowed because it is discoverable).
   * Mirrors ServerPublicInvite.join.
   */
  async join(): Promise<Server> {
    const existingServer = this.client.servers.get(this.id);
    if (existingServer) return existingServer;

    const [headerKey, headerValue] = this.client.authenticationHeader;
    const response = await fetch(
      `${this.client.options.baseURL}/servers/${this.id}/join`,
      {
        method: "POST",
        headers: { [headerKey]: headerValue },
      },
    );
    if (!response.ok) throw await response.json();

    const result = await response.json();
    if (result.type === "Server") {
      return batch(() => {
        for (const channel of result.channels) {
          this.client.channels.getOrCreate(channel._id, channel);
        }

        return this.client.servers.getOrCreate(
          result.server._id,
          result.server,
          true,
        );
      });
    } else {
      throw "unreachable";
    }
  }
}
