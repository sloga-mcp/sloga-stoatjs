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
 * it, the embedding app reads it from `GET /` itself. A server that sends
 * no such object has every field false.
 */
export type PasskeysAdvert = {
  /**
   * Passkey sign-in, adding and removing passkeys, confirming with a passkey
   */
  available: boolean;
  /**
   * An account can be created with a passkey. Also what lost-passkey
   * recovery and "add an email" need: with it false, `passkeySignup*`,
   * `passkeyRecover*` and `account.addEmail*` reject with `FeatureDisabled`.
   */
  signup: boolean;
  /**
   * Such an account can be created without an email address. Never true
   * while `signup` is false. With it false, a sign-up needs an email.
   */
  signup_without_email: boolean;
  backup_unlock: boolean;
};

/**
 * Answer of `POST /auth/passkey/register/start`
 * (`client.passkeys.registerStart`): a challenge, plus whether the finish
 * step will ask for an MFA ticket
 */
export type ResponsePasskeyRegisterStart = PasskeyChallenge & {
  /**
   * Whether `registerFinish` needs an MFA ticket. A hint: the server decides
   * again at finish, and a session that was young enough at start may be too
   * old by then (`NotPrivileged`; get a ticket and start again).
   *
   * `registerStart` fills it in as true when the server sent none (a server
   * that predates the field always wants a ticket).
   */
  ticket_required: boolean;
};

/**
 * Body of `POST /auth/passkey/signup/start`
 */
export type DataPasskeySignupStart = {
  /**
   * Username for the new account
   */
  username: string;
  /**
   * Email address. Leave out to sign up with no email.
   */
  email?: string;
  /**
   * Must be true when no email is given: the person was told the account
   * cannot be recovered if the passkey is lost
   */
  no_email_ack?: boolean;
  /**
   * Account invite code, where sign-up is invite-only
   */
  invite?: string;
  /**
   * Referral code
   */
  referral_code?: string;
  /**
   * Server invite the person arrived through
   */
  invite_code?: string;
  /**
   * Captcha verification code
   */
  captcha?: string;
};

/**
 * Answer of `POST /auth/passkey/signup/start`
 */
export type ResponsePasskeySignupStart = {
  /**
   * Id of the pending sign-up, handed back at each later step. A secret
   * for as long as the sign-up is pending: keep it out of logs.
   */
  signup_id: string;
  /**
   * Whether a code was mailed and has to be confirmed
   * (`passkeySignupCode`) before the passkey can be created
   */
  email_code_required: boolean;
};

/**
 * Body of `POST /auth/passkey/signup/code`
 */
export type DataPasskeySignupCode = {
  signup_id: string;
  /**
   * The code from the email
   */
  code: string;
};

/**
 * Body of `POST /auth/passkey/signup/options` and of
 * `POST /auth/passkey/signup/resend`
 */
export type DataPasskeySignupOptions = {
  signup_id: string;
};

/**
 * Body of `POST /auth/passkey/signup/finish`
 */
export type DataPasskeySignupFinish = {
  /**
   * Id of the challenge `signup/options` answered with
   */
  challenge_id: string;
  credential: PasskeyCredentialJSON;
  /**
   * Friendly name used for the session
   */
  friendly_name?: string;
};

/**
 * Body of `POST /auth/passkey/recover/send`
 */
export type DataPasskeyRecoverSend = {
  email: string;
};

/**
 * Body of `POST /auth/passkey/recover/start`
 */
export type DataPasskeyRecoverStart = {
  /**
   * The token from the recovery link
   */
  token: string;
};

/**
 * Answer of `POST /auth/passkey/recover/start`: a challenge for the new
 * passkey, plus whether the finish step also needs a second factor. The
 * account's existing passkeys are not listed in the options.
 */
export type ResponsePasskeyRecoverStart = PasskeyChallenge & {
  /**
   * Whether `passkeyRecoverFinish` also needs an authenticator code or an
   * MFA recovery code
   */
  second_factor_required: boolean;
};

/**
 * The second factor of a passkey recovery: an authenticator code or an MFA
 * recovery code, never both. A passkey is not accepted here.
 */
export type PasskeyRecoverSecondFactor =
  | { totp_code: string; recovery_code?: undefined }
  | { recovery_code: string; totp_code?: undefined };

/**
 * Body of `POST /auth/passkey/recover/finish`
 */
export type DataPasskeyRecoverFinish = {
  /**
   * The token from the recovery link
   */
  token: string;
  /**
   * Id of the challenge `recover/start` answered with
   */
  challenge_id: string;
  credential: PasskeyCredentialJSON;
  /**
   * Authenticator code
   */
  totp_code?: string;
  /**
   * MFA recovery code
   */
  recovery_code?: string;
};

/**
 * Body of `POST /auth/account/email/add/start`
 */
export type DataEmailAddStart = {
  email: string;
};

/**
 * Body of `POST /auth/account/email/add/finish`
 */
export type DataEmailAddFinish = {
  /**
   * The code from the email
   */
  code: string;
};

/**
 * Body of `POST /auth/account/delete`. Optional: only an account with no
 * email address needs it.
 */
export type DataDeleteAccount = {
  /**
   * The account's username, typed out to confirm (exact match, case and
   * all). Required from an account that has no email address; ignored from
   * every other account.
   */
  username?: string;
};

/**
 * Answer of `GET /auth/account/`, including fields newer than the published
 * API types
 */
export type AccountInfo = {
  _id: string;
  /**
   * Email address; empty when the account has none
   */
  email: string;
  /**
   * Whether the account has no email address. `account.fetchInfo` fills it
   * in as false when the server sent none (a server that predates the
   * field has no such accounts).
   */
  email_absent: boolean;
};
