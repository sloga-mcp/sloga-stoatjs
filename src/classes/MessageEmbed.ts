import type { Embed, ImageSize, Special } from "stoat-api";

import type { Client } from "../Client.js";

import { File } from "./File.js";

/**
 * Audio embed as sent by the API (direct link to an audio file)
 */
export type AudioEmbedData = {
  type: "Audio";
  url: string;
  content_type: string;
  size?: number;
  filename?: string;
};

/**
 * Message Embed
 */
export abstract class MessageEmbed {
  protected client?: Client;
  readonly type: Embed["type"] | "Audio";

  /**
   * Construct Embed
   * @param client Client
   * @param type Type
   */
  constructor(client?: Client, type: Embed["type"] | "Audio" = "None") {
    this.client = client;
    this.type = type;
  }

  /**
   * Create an Embed from an API Embed
   * @param client Client
   * @param embed Data
   * @returns Embed
   */
  static from(client: Client, embed: Embed | AudioEmbedData): MessageEmbed {
    switch (embed.type) {
      case "Image":
        return new ImageEmbed(client, embed);
      case "Video":
        return new VideoEmbed(client, embed);
      case "Website":
        return new WebsiteEmbed(client, embed);
      case "Text":
        return new TextEmbed(client, embed);
      case "Audio":
        return new AudioEmbed(client, embed);
      default:
        return new UnknownEmbed(client);
    }
  }
}

/**
 * Embed of unknown type
 */
export class UnknownEmbed extends MessageEmbed {}

/**
 * Image Embed
 */
export class ImageEmbed extends MessageEmbed {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly size: ImageSize;

  /**
   * Construct Image Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(client: Client, embed: Omit<Embed & { type: "Image" }, "type">) {
    super(client, "Image");

    this.url = embed.url;
    this.width = embed.width;
    this.height = embed.height;
    this.size = embed.size;
  }

  /**
   * Proxied image URL
   */
  get proxiedURL(): string | undefined {
    return this.client?.proxyFile(this.url);
  }
}

/**
 * Video Embed
 */
export class VideoEmbed extends MessageEmbed {
  readonly url: string;
  readonly width: number;
  readonly height: number;

  /**
   * Construct Video Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(client: Client, embed: Omit<Embed & { type: "Video" }, "type">) {
    super(client, "Video");

    this.url = embed.url;
    this.width = embed.width;
    this.height = embed.height;
  }

  /**
   * Proxied video URL
   */
  get proxiedURL(): string | undefined {
    return this.client?.proxyFile(this.url);
  }
}

/**
 * Audio Embed
 */
export class AudioEmbed extends MessageEmbed {
  readonly url: string;
  readonly contentType: string;
  readonly size?: number;
  readonly filename?: string;

  /**
   * Construct Audio Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(client: Client, embed: Omit<AudioEmbedData, "type">) {
    super(client, "Audio");

    this.url = embed.url;
    this.contentType = embed.content_type;
    this.size = embed.size;
    this.filename = embed.filename;
  }

  /**
   * Proxied audio URL (January's streaming audio route), or undefined
   * when January is unavailable; never the raw third-party URL
   */
  get proxiedURL(): string | undefined {
    const january = this.client?.configuration?.features.january;
    if (january?.enabled) {
      return `${january.url}/audio?url=${encodeURIComponent(this.url)}`;
    }

    return undefined;
  }
}

/**
 * Website Embed
 */
export class WebsiteEmbed extends MessageEmbed {
  readonly url?: string;
  readonly originalUrl?: string;
  readonly specialContent?: Special;
  readonly title?: string;
  readonly description?: string;
  readonly image?: ImageEmbed;
  readonly video?: VideoEmbed;
  readonly siteName?: string;
  readonly iconUrl?: string;
  readonly colour?: string;

  /**
   * Construct Video Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(
    client: Client,
    embed: Omit<Embed & { type: "Website" }, "type">,
  ) {
    super(client, "Website");

    this.url = embed.url!;
    this.originalUrl = embed.original_url!;
    this.specialContent = embed.special!;
    this.title = embed.title!;
    this.description = embed.description!;
    this.image = embed.image ? new ImageEmbed(client, embed.image) : undefined;
    this.video = embed.video ? new VideoEmbed(client, embed.video) : undefined;
    this.siteName = embed.site_name!;
    this.iconUrl = embed.icon_url!;
    this.colour = embed.colour!;
  }

  /**
   * Proxied icon URL
   */
  get proxiedIconURL(): string | undefined {
    return this.iconUrl ? this.client?.proxyFile(this.iconUrl) : undefined;
  }

  /**
   * If special content is present, generate the embed URL
   */
  get embedURL(): string | undefined {
    switch (this.specialContent?.type) {
      case "YouTube": {
        let timestamp = "";

        if (this.specialContent.timestamp) {
          timestamp = `&start=${this.specialContent.timestamp}`;
        }

        return `https://www.youtube-nocookie.com/embed/${this.specialContent.id}?modestbranding=1${timestamp}`;
      }
      case "Twitch":
        return `https://player.twitch.tv/?${this.specialContent.content_type.toLowerCase()}=${
          this.specialContent.id
        }&parent=${(window ?? {})?.location?.hostname}&autoplay=false`;
      case "Lightspeed":
        return `https://new.lightspeed.tv/embed/${this.specialContent.id}/stream`;
      case "Spotify":
        return `https://open.spotify.com/embed/${this.specialContent.content_type}/${this.specialContent.id}`;
      case "Soundcloud":
        return `https://w.soundcloud.com/player/?url=${encodeURIComponent(
          this.url!,
        )}&color=%23FF7F50&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true`;
      case "Bandcamp": {
        return `https://bandcamp.com/EmbeddedPlayer/${this.specialContent.content_type.toLowerCase()}=${
          this.specialContent.id
        }/size=large/bgcol=181a1b/linkcol=056cc4/tracklist=false/transparent=true/`;
      }
      case "Streamable": {
        return `https://streamable.com/e/${this.specialContent.id}?loop=0`;
      }
    }
  }
}

/**
 * Text Embed
 */
export class TextEmbed extends MessageEmbed {
  readonly iconUrl?: string;
  readonly url?: string;
  readonly title?: string;
  readonly description?: string;
  readonly media?: File;
  readonly colour?: string;

  /**
   * Construct Video Embed
   * @param client Client
   * @param embed Embed
   */
  constructor(client: Client, embed: Omit<Embed & { type: "Text" }, "type">) {
    super(client, "Text");

    this.iconUrl = embed.icon_url!;
    this.url = embed.url!;
    this.title = embed.title!;
    this.description = embed.description!;
    this.media = embed.media ? new File(client, embed.media) : undefined;
    this.colour = embed.colour!;
  }

  /**
   * Proxied icon URL
   */
  get proxiedIconURL(): string | undefined {
    return this.iconUrl ? this.client?.proxyFile(this.iconUrl) : undefined;
  }
}
