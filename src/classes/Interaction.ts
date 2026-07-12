// ----- Wire types -------------------------------------------------------------
// stoat-api 0.13.5 predates slash-command interactions, so the wire shapes are
// declared locally (Thread.ts / Forum.ts / CalendarEvent precedent) to match
// the Rust `v0` models exactly (serde: `_id`, snake_case).

import type { Client } from "../Client.js";

/** Type of a command option value. */
export type CommandOptionKind =
  | "String"
  | "Integer"
  | "Boolean"
  | "User"
  | "Channel";

/** A fixed choice a command option may offer. */
export interface CommandChoice {
  name: string;
  value: string;
}

/** A typed option (argument) accepted by a command. */
export interface CommandOptionData {
  name: string;
  description: string;
  kind: CommandOptionKind;
  required?: boolean;
  choices?: CommandChoice[];
}

/** A slash command registered by a bot (`v0::ApplicationCommand`). */
export interface ApplicationCommandData {
  _id: string;
  bot_id: string;
  /** Server this command is scoped to; absent = global. */
  server?: string;
  name: string;
  description: string;
  options?: CommandOptionData[];
}

/** `POST /bots/{bot}/commands` body. */
export interface DataCreateCommand {
  name: string;
  description: string;
  server?: string;
  options?: CommandOptionData[];
}

/** `PATCH /bots/{bot}/commands/{command}` body. */
export interface DataEditCommand {
  name?: string;
  description?: string;
  options?: CommandOptionData[];
}

/** What kind of interaction this is. */
export type InteractionKind =
  | "Command"
  | "Component"
  | "Autocomplete"
  | "ModalSubmit";

/**
 * Wire payload of the `InteractionCreate` event (`v0::Interaction`).
 *
 * Delivered ONLY to the target bot's private topic — it carries the
 * single-use response token.
 */
export interface InteractionCreateEvent {
  _id: string;
  kind: InteractionKind;
  channel_id: string;
  user_id: string;
  bot_id: string;
  command_id?: string;
  command_name?: string;
  options?: Record<string, string>;
  token: string;
}

/** Interaction context carried on a bot's response message ("used /cmd"). */
export interface MessageInteractionData {
  /** Id of the interaction this message responds to. */
  id: string;
  /** User who invoked the command. */
  user_id: string;
  /** Name of the invoked command. */
  command_name: string;
}

/**
 * Respond to an interaction as the connected bot.
 *
 * Bot-facing helper (the same library powers bots): pass the id and token
 * received in the `interactionCreate` event. Responds with a regular channel
 * message carrying the unforgeable interaction context.
 */
export async function respondToInteraction(
  client: Client,
  interactionId: string,
  token: string,
  content: string,
): Promise<unknown> {
  return await client.channels.apiReq(
    "POST",
    `/interactions/${interactionId}/respond`,
    { body: { token, content } },
  );
}
