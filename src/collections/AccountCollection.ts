import type {
  DataChangeEmail,
  DataChangePassword,
  DataCreateAccount,
  WebPushSubscription,
} from "stoat-api";

import type { Client } from "../Client.js";
import { MFA } from "../classes/MFA.js";
import type { AccountInfo } from "../types/passkeys.js";

/**
 * Utility functions for working with accounts
 */
export class AccountCollection {
  readonly client: Client;

  /**
   * Create generic class collection
   * @param client Client
   */
  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Fetch current account email
   * @returns Email
   */
  async fetchEmail(): Promise<string> {
    return (await this.client.api.get("/auth/account/")).email;
  }

  /**
   * Fetch current account id, email, and whether it has an email at all.
   *
   * An account created with a passkey may have none: `email` is then `""`
   * and `email_absent` is true. Such an account gets its first address with
   * {@link addEmailStart}, cannot use {@link changePassword} until it has
   * one, cannot recover a lost passkey, and deletes with a typed username
   * (see `MFATicket.deleteAccount`).
   * @returns Account info; `email_absent` is false when the server sent none
   */
  async fetchInfo(): Promise<AccountInfo> {
    const info = (await this.client.api.get("/auth/account/")) as {
      _id: string;
      email: string;
      email_absent?: unknown;
    };

    // Only a plain true says so
    return { ...info, email_absent: info.email_absent === true };
  }

  /**
   * Start giving an account that has no email its first address: an
   * 8-digit code is mailed to it, to be typed into the app and given to
   * {@link addEmailFinish}. There is no link to click. The code lasts 15
   * minutes.
   *
   * Resolves (204) whether or not a code was sent: an address that already
   * has an account gets a notice instead of a code, a second request within
   * a minute sends nothing, and neither does a request for an address that
   * was mailed too often lately. Never treat this call resolving as proof a
   * code went out.
   *
   * Rejects with the parsed API error body: `FeatureDisabled` unless both
   * passkeys and passkey sign-up are on (`features.passkeys.available` and
   * `.signup`), `InvalidOperation` for an account that already has an email
   * (that one uses {@link changeEmail}), `FailedValidation` or another
   * email error for an address the server will not take.
   * @param email Email address
   * @param ticket Valid MFA ticket token
   */
  async addEmailStart(email: string, ticket: string): Promise<void> {
    await this.#apiReq(
      "POST",
      "/auth/account/email/add/start",
      { email },
      { "X-MFA-Ticket": ticket },
    );
  }

  /**
   * Confirm the code {@link addEmailStart} mailed, from the same session.
   * The address becomes the account's email. Takes no MFA ticket.
   *
   * A wrong, expired or used code, a code that ran out of tries (five), and
   * an address that another account took meanwhile all reject with
   * `InvalidCredentials`; they cannot be told apart. Rejects with
   * `FeatureDisabled` unless both passkeys and passkey sign-up are on, and
   * with `InvalidOperation` for an account that already has an email.
   * @param code The code from the email
   */
  async addEmailFinish(code: string): Promise<void> {
    await this.#apiReq("POST", "/auth/account/email/add/finish", { code });
  }

  /**
   * Create a MFA helper
   */
  async mfa(): Promise<MFA> {
    return new MFA(this.client, await this.client.api.get("/auth/mfa/"));
  }

  /**
   * Create a new account
   * @param data Account details
   */
  create(data: DataCreateAccount): Promise<void> {
    return this.client.api.post("/auth/account/create", data);
  }

  /**
   * Resend email verification
   * @param email Email
   * @param captcha Captcha if enabled
   */
  reverify(email: string, captcha?: string): Promise<void> {
    return this.client.api.post("/auth/account/reverify", { email, captcha });
  }

  /**
   * Send password reset email
   * @param email Email
   * @param captcha Captcha if enabled
   */
  resetPassword(email: string, captcha?: string): Promise<void> {
    return this.client.api.post("/auth/account/reset_password", {
      email,
      captcha,
    });
  }

  /**
   * Verify an account given the code
   * @param code Verification code
   */
  verify(code: string): Promise<unknown> {
    return this.client.api.post(`/auth/account/verify/${code}`);
  }

  /**
   * Confirm account deletion
   * @param token Deletion token
   */
  confirmDelete(token: string): Promise<void> {
    return this.client.api.put("/auth/account/delete", { token });
  }

  /**
   * Confirm password reset
   * @param token Token
   * @param newPassword New password
   * @param removeSessions Whether to remove existing sessions
   */
  confirmPasswordReset(
    token: string,
    newPassword: string,
    removeSessions: boolean,
  ): Promise<void> {
    return this.client.api.patch("/auth/account/reset_password", {
      token,
      password: newPassword,
      remove_sessions: removeSessions,
    });
  }

  /**
   * Change account password
   *
   * Rejects with `InvalidOperation` for an account that has no email: it
   * adds an email first ({@link addEmailStart}). This call goes through
   * `client.api`, which rejects with the error body as text (a JSON
   * string), not a parsed object.
   * @param newPassword New password
   * @param currentPassword Current password; leave out for an account with
   * no password, which gives a ticket instead
   * @param ticket Valid MFA ticket token
   */
  changePassword(
    newPassword: string,
    currentPassword?: string,
    ticket?: string,
  ): Promise<void> {
    return this.client.api.patch(
      "/auth/account/change/password",
      // The server accepts current_password missing; the published type does not
      {
        password: newPassword,
        ...(currentPassword === undefined
          ? {}
          : { current_password: currentPassword }),
      } as DataChangePassword,
      ticket === undefined
        ? undefined
        : { headers: { "X-MFA-Ticket": ticket } },
    );
  }

  /**
   * Change account email
   *
   * Rejects with `InvalidOperation` for every account that has no
   * password, with or without a ticket, and for every account that has no
   * email. An account with no email uses {@link addEmailStart}; one with
   * an email and no password sets a password first
   * ({@link changePassword}). This call goes through `client.api`, which
   * rejects with the error body as text (a JSON string), not a parsed
   * object.
   * @param newEmail New email
   * @param currentPassword Current password. Required by the server: a
   * ticket does not stand in for it (leaving it out rejects with
   * `InvalidCredentials`).
   * @param ticket Valid MFA ticket token, needed as well when the account
   * has MFA on
   */
  changeEmail(
    newEmail: string,
    currentPassword?: string,
    ticket?: string,
  ): Promise<void> {
    return this.client.api.patch(
      "/auth/account/change/email",
      // The server accepts current_password missing; the published type does not
      {
        email: newEmail,
        ...(currentPassword === undefined
          ? {}
          : { current_password: currentPassword }),
      } as DataChangeEmail,
      ticket === undefined
        ? undefined
        : { headers: { "X-MFA-Ticket": ticket } },
    );
  }

  /**
   * Fetch settings
   * @param keys Keys
   * @returns Settings
   */
  fetchSettings(keys: string[]): Promise<Record<string, [number, string]>> {
    return this.client.api.post("/sync/settings/fetch", { keys }) as Promise<
      Record<string, [number, string]>
    >;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  /**
   * Set settings
   * @param settings Settings
   * @param timestamp Timestamp
   */
  setSettings(
    settings: Record<string, any>,
    timestamp = +new Date(),
  ): Promise<void> {
    return this.client.api.post("/sync/settings/set", {
      ...settings,
      timestamp,
    });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /**
   * Create a new Web Push subscription
   * @param subscription Subscription
   */
  webPushSubscribe(subscription: WebPushSubscription): Promise<void> {
    return this.client.api.post("/push/subscribe", subscription);
  }

  /**
   * Remove existing Web Push subscription
   */
  webPushUnsubscribe(): Promise<void> {
    return this.client.api.post("/push/unsubscribe");
  }

  /**
   * Raw request against a route missing from stoat-api's tables, whose
   * typed client would send an empty `{}` body. Same as `Client.#apiReq`:
   * on a non-2xx this throws the parsed JSON error body, not an `Error`.
   */
  async #apiReq(
    method: string,
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    const api = this.client.api as unknown as {
      baseURL: string;
      auth: Record<string, string>;
    };

    const response = await fetch(api.baseURL + path, {
      method,
      headers: {
        ...api.auth,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      let error: unknown = text;
      try {
        error = JSON.parse(text);
      } catch {
        /* keep the raw text */
      }
      throw error;
    }

    return response.status === 204 ? null : response.json();
  }
}
