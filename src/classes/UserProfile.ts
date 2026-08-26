import type { UserProfile as APIUserProfile } from "stoat-api";

import type { Client } from "../Client.js";

import { File } from "./File.js";

/**
 * A self-declared game-account link shown on the profile.
 * Newer than the published stoat-api types.
 */
export type ProfileLink = {
  platform: string;
  handle: string;
};

/**
 * User Profile Class
 */
export class UserProfile {
  readonly content?: string;
  readonly banner?: File;
  readonly links: ProfileLink[];

  /**
   * Construct Public Bot
   * @param client Client
   * @param data Data
   */
  constructor(client: Client, data: APIUserProfile) {
    this.content = data.content!;
    this.banner = data.background
      ? new File(client, data.background)
      : undefined;
    // `links` is newer than the published stoat-api types; absent = none
    this.links = (data as APIUserProfile & { links?: ProfileLink[] }).links ?? [];
  }

  /**
   * URL to the user's banner
   */
  get bannerURL(): string | undefined {
    return this.banner?.createFileURL();
  }

  /**
   * URL to the user's animated banner
   */
  get animatedBannerURL(): string | undefined {
    return this.banner?.createFileURL(true);
  }
}
