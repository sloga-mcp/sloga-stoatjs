import type {
  MFAMethod,
  MFAResponse,
  MultiFactorStatus,
  ResponseLogin,
} from "stoat-api";

/**
 * WebAuthn `publicKey` options in their JSON form (base64url strings), as
 * the server sends them. Opaque here: the SDK never reads or changes it, and
 * never runs a ceremony; the embedding app does.
 */
export type PasskeyOptionsJSON = Record<string, unknown>;

/**
 * A `PublicKeyCredential` in its JSON form (the `toJSON()` shape), as the
 * embedding app got it from the ceremony. Opaque here: the SDK sends it as
 * given and never reads or changes it.
 */
export type PasskeyCredentialJSON = Record<string, unknown>;

/**
 * A started passkey ceremony: the options to run it with, and the id to send
 * back with its result
 */
export type PasskeyChallenge = {
  challenge_id: string;
  options: PasskeyOptionsJSON;
};

/**
 * A passkey saved on the account
 */
export type PasskeyInfo = {
  id: string;
  name: string;
  /**
   * When it was added (iso8601 timestamp)
   */
  created_at: string;
  /**
   * When it was last used (iso8601 timestamp); absent if never
   */
  last_used_at?: string;
};

/**
 * Result of a passkey sign-in: a session, or a disabled account. Never an
 * MFA step.
 */
export type PasskeyLoginResponse =
  | Extract<ResponseLogin, { result: "Success" }>
  | (Extract<ResponseLogin, { result: "Disabled" }> & {
      /**
       * When a temporary suspension ends (iso8601 timestamp); absent when
       * the account is disabled with no end date
       */
      suspended_until?: string | null;
    });

/**
 * Methods an MFA ticket can be created with, including ones newer than the
 * published API types
 */
export type MFATicketMethod = MFAMethod | "Passkey";

/**
 * The result of a passkey ceremony started with `client.passkeys.assertStart`,
 * given as the factor for an MFA ticket
 */
export type PasskeyMFAResponse = {
  passkey_response: {
    challenge_id: string;
    credential: PasskeyCredentialJSON;
  };
};

/**
 * Factor given to create an MFA ticket, including ones newer than the
 * published API types
 */
export type MFATicketResponse = MFAResponse | PasskeyMFAResponse;

/**
 * MFA status of the account, including fields newer than the published API
 * types. Both are absent on servers that predate passkeys.
 */
export type MFAStatus = Omit<MultiFactorStatus, "security_key_mfa"> & {
  /**
   * Whether the account has at least one passkey
   */
  security_key_mfa?: boolean;
  /**
   * Whether the account has no usable password
   */
  password_absent?: boolean;
};

/**
 * Passkey part of the server's feature advert at `GET /`
 * (`features.passkeys`). Typing only: `client.configuration` does not carry
 * it, the embedding app reads it from `GET /` itself.
 */
export type PasskeysAdvert = {
  available: boolean;
  signup: boolean;
  signup_without_email: boolean;
  backup_unlock: boolean;
};
