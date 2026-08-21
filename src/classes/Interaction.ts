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
  /**
   * Ask the bot for suggestions as the user types this option
   * (String/Integer only, and mutually exclusive with `choices`).
   */
  autocomplete?: boolean;
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

// ----- Message components (slice 2) -------------------------------------------

/** Visual style of a button component. */
export type ButtonStyle = "Primary" | "Secondary" | "Success" | "Danger";

/** One choice offered by a string select. */
export interface SelectOptionData {
  label: string;
  value: string;
}

/** A clickable button (`v0::Component::Button`). */
export interface ButtonComponent {
  type: "Button";
  custom_id: string;
  label: string;
  style: ButtonStyle;
  disabled?: boolean;
}

/** A single-choice dropdown (`v0::Component::StringSelect`). */
export interface StringSelectComponent {
  type: "StringSelect";
  custom_id: string;
  options: SelectOptionData[];
  placeholder?: string;
  disabled?: boolean;
}

/** An interactive component on a message (serde tag `type`). */
export type ComponentData = ButtonComponent | StringSelectComponent;

/** A horizontal row of components (5 buttons, or exactly 1 select). */
export interface ActionRowData {
  components: ComponentData[];
}

// ----- Modals (slice 3) --------------------------------------------------------

/** Visual style of a modal text input. */
export type TextInputStyle = "Short" | "Paragraph";

/** One text field on a modal (`v0::ModalTextInput`). */
export interface ModalTextInputData {
  custom_id: string;
  label: string;
  style: TextInputStyle;
  required?: boolean;
  min_length?: number;
  max_length?: number;
  placeholder?: string;
  /** Value the field opens with. */
  value?: string;
}

/**
 * A form a bot asks the invoking user to fill in (`v0::Modal`).
 *
 * Inputs are a flat list, not component rows: a modal only ever holds text
 * inputs, one per row, so rows would carry no information.
 */
export interface ModalData {
  custom_id: string;
  title: string;
  inputs: ModalTextInputData[];
}

/**
 * Wire payload of the `InteractionAutocompleteResult` event.
 *
 * Delivered ONLY to the user who is typing.
 */
export interface AutocompleteResultEvent {
  interaction_id: string;
  choices: CommandChoice[];
}

/**
 * Wire payload of the `InteractionModalOpen` event.
 *
 * Delivered ONLY to the user the form is for. `interaction_id` is a FRESH
 * interaction to submit the completed form against; `source_id` is the
 * interaction that opened it, so a pending invocation can be resolved.
 */
export interface ModalOpenEvent {
  interaction_id: string;
  source_id: string;
  modal: ModalData;
}

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
  /** Message the interaction targets (Component kind). */
  message_id?: string;
  command_id?: string;
  command_name?: string;
  /** Custom id of the clicked component (Component kind). */
  custom_id?: string;
  /** Submitted select values (Component kind, selects only). */
  values?: string[];
  /**
   * Supplied option values. Schema-validated for Command; whatever has been
   * typed so far for Autocomplete; submitted fields keyed by input id for
   * ModalSubmit.
   */
  options?: Record<string, string>;
  /** Option the user is currently typing (Autocomplete kind). */
  focused_option?: string;
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

/** Optional extras for {@link respondToInteraction}. */
export interface RespondToInteractionOptions {
  /** Components to attach (or replace, when editing). */
  components?: ActionRowData[];
  /**
   * Edit the message the component lives on instead of sending a new
   * message (Component interactions only).
   */
  edit?: boolean;
  /**
   * Deliver the response only to the invoking user. Ephemeral responses
   * are never persisted (gone on reload). Incompatible with `edit` and
   * with `components`.
   */
  ephemeral?: boolean;
}

/**
 * Respond to an interaction as the connected bot.
 *
 * Bot-facing helper (the same library powers bots): pass the id and token
 * received in the `interactionCreate` event. Command responses fan out as a
 * regular channel message carrying the unforgeable interaction context;
 * component responses may instead pass `edit: true` to update the message
 * the clicked component lives on.
 */
export async function respondToInteraction(
  client: Client,
  interactionId: string,
  token: string,
  content?: string,
  options?: RespondToInteractionOptions,
): Promise<unknown> {
  return await client.channels.apiReq(
    "POST",
    `/interactions/${interactionId}/respond`,
    {
      body: {
        token,
        ...(content !== undefined ? { content } : {}),
        ...(options?.components ? { components: options.components } : {}),
        ...(options?.edit ? { edit: true } : {}),
        ...(options?.ephemeral ? { ephemeral: true } : {}),
      },
    },
  );
}

/**
 * Answer an autocomplete interaction with suggestions.
 *
 * Bot-facing helper. An empty list is a valid answer meaning "nothing
 * matches". Autocomplete interactions expire after one minute rather than
 * fifteen — by then the caret has moved on.
 */
export async function respondWithAutocomplete(
  client: Client,
  interactionId: string,
  token: string,
  choices: CommandChoice[],
): Promise<unknown> {
  return await client.channels.apiReq(
    "POST",
    `/interactions/${interactionId}/autocomplete`,
    { body: { token, choices } },
  );
}

/**
 * Answer an interaction by asking the invoking user to fill in a form.
 *
 * Bot-facing helper. This CONSUMES the interaction's single response slot,
 * so it is an alternative to {@link respondToInteraction}, not something to
 * do as well. The completed form arrives as a fresh `interactionCreate` of
 * kind `ModalSubmit`, with its own token.
 */
export async function respondWithModal(
  client: Client,
  interactionId: string,
  token: string,
  modal: ModalData,
): Promise<unknown> {
  return await client.channels.apiReq(
    "POST",
    `/interactions/${interactionId}/modal`,
    { body: { token, modal } },
  );
}

/**
 * Submit a filled-in form.
 *
 * User-facing, unlike its neighbours: this is authenticated by the session
 * of the person the form was shown to, and takes no interaction token. The
 * values are keyed by text input id.
 */
export async function submitModal(
  client: Client,
  interactionId: string,
  values: Record<string, string>,
): Promise<unknown> {
  return await client.channels.apiReq(
    "POST",
    `/interactions/${interactionId}/modal-submit`,
    { body: { values } },
  );
}
