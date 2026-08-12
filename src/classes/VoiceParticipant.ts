import { Accessor, Setter, createSignal } from "solid-js";

import type { Client } from "../Client.js";
import { UserVoiceState } from "../events/v1.js";

/**
 * Voice Participant
 */
export class VoiceParticipant {
  protected client: Client;
  readonly userId: string;
  readonly joinedAt: Date;

  readonly isReceiving: Accessor<boolean>;
  readonly isPublishing: Accessor<boolean>;
  /**
   * True while EITHER a screen-video or screen-audio track is live (the
   * historical conflated flag). Use `isScreenVideo` when the consumer needs
   * "there is actually video to look at".
   */
  readonly isScreensharing: Accessor<boolean>;
  readonly isCamera: Accessor<boolean>;
  /** True only while a screen VIDEO track is live. */
  readonly isScreenVideo: Accessor<boolean>;
  /**
   * True while this participant says they are recording the call locally.
   *
   * A self-report the server relays, not something it observed — see
   * `UserVoiceState.recording`. Present on a participant fetched before
   * joining, which is what lets a pre-join surface warn about a recording
   * already in progress.
   */
  readonly isRecording: Accessor<boolean>;
  /**
   * True while this participant's client says it can RECEIVE remote control
   * (a desktop build with a working native layer).
   *
   * A self-report the server relays, not something it verified — see
   * `UserVoiceState.rc_capable`. False also covers "hasn't said": clients
   * that predate the announce route are capable but silent, so absence must
   * be rendered as unknown, never as "cannot take control".
   */
  readonly isRcCapable: Accessor<boolean>;

  #setReceiving: Setter<boolean>;
  #setPublishing: Setter<boolean>;
  #setScreensharing: Setter<boolean>;
  #setCamera: Setter<boolean>;
  #setScreenVideo: Setter<boolean>;
  #setRecording: Setter<boolean>;
  #setRcCapable: Setter<boolean>;

  /**
   * Construct Server Ban
   * @param client Client
   * @param data Data
   */
  constructor(client: Client, data: UserVoiceState) {
    this.client = client;
    this.userId = data.id;
    this.joinedAt = new Date(data.joined_at);

    const [isReceiving, setReceiving] = createSignal(data.is_receiving);
    this.isReceiving = isReceiving;
    this.#setReceiving = setReceiving;

    const [isPublishing, setPublishing] = createSignal(data.is_publishing);
    this.isPublishing = isPublishing;
    this.#setPublishing = setPublishing;

    const [isScreensharing, setScreensharing] = createSignal(
      data.screensharing,
    );
    this.isScreensharing = isScreensharing;
    this.#setScreensharing = setScreensharing;

    const [isCamera, setCamera] = createSignal(data.camera);
    this.isCamera = isCamera;
    this.#setCamera = setCamera;

    // Absent from payloads sent by older servers — treat missing as false.
    const [isScreenVideo, setScreenVideo] = createSignal(
      data.screen_video ?? false,
    );
    this.isScreenVideo = isScreenVideo;
    this.#setScreenVideo = setScreenVideo;

    const [isRecording, setRecording] = createSignal(data.recording ?? false);
    this.isRecording = isRecording;
    this.#setRecording = setRecording;

    const [isRcCapable, setRcCapable] = createSignal(data.rc_capable ?? false);
    this.isRcCapable = isRcCapable;
    this.#setRcCapable = setRcCapable;
  }

  /**
   * Update the state
   * @param data Data
   */
  update(data: Partial<UserVoiceState>) {
    if (typeof data.is_receiving === "boolean") {
      this.#setReceiving(data.is_receiving);
    }

    if (typeof data.is_publishing === "boolean") {
      this.#setPublishing(data.is_publishing);
    }

    if (typeof data.screensharing === "boolean") {
      this.#setScreensharing(data.screensharing);
    }

    if (typeof data.camera === "boolean") {
      this.#setCamera(data.camera);
    }

    if (typeof data.screen_video === "boolean") {
      this.#setScreenVideo(data.screen_video);
    }

    if (typeof data.recording === "boolean") {
      this.#setRecording(data.recording);
    }

    if (typeof data.rc_capable === "boolean") {
      this.#setRcCapable(data.rc_capable);
    }
  }
}
