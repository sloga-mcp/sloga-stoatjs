import type { SetStoreFunction } from "solid-js/store";
import { createStore } from "solid-js/store";

import type { MFAResponse, MFATicket as TicketType } from "stoat-api";

import type { Client } from "../Client.js";
import { availableMfaMethods } from "../lib/mfaMethods.js";
import type {
  MFAStatus,
  MFATicketMethod,
  MFATicketResponse,
} from "../types/passkeys.js";

/**
 * Multi-Factor Authentication
 */
export class MFA {
  #client: Client;
  #store: [MFAStatus, SetStoreFunction<MFAStatus>];

  /**
   * Construct MFA helper
   * @param client Client
   * @param state State
   */
  constructor(client: Client, state: MFAStatus) {
    this.#client = client;
    this.#store = createStore(state);
  }

  /**
   * Whether the account has at least one passkey; false on servers that
   * predate passkeys
   */
  get passkeyEnabled(): boolean {
    return this.#store[0].security_key_mfa === true;
  }

  /**
   * Whether the account has no usable password; false on servers that
   * predate passkeys
   */
  get passwordAbsent(): boolean {
    return this.#store[0].password_absent === true;
  }

  /**
   * Whether authenticator app is enabled
   */
  get authenticatorEnabled(): boolean {
    return this.#store[0].totp_mfa;
  }

  /**
   * Whether recovery codes are enabled
   */
  get recoveryEnabled(): boolean {
    return this.#store[0].recovery_active;
  }

  /**
   * Available MFA methods for generating tickets, easiest first. Empty for
   * an account with no usable password, no passkey and no authenticator.
   */
  get availableMethods(): MFATicketMethod[] {
    const state = this.#store[0];
    return availableMfaMethods({
      totp_mfa: state.totp_mfa,
      recovery_active: state.recovery_active,
      security_key_mfa: state.security_key_mfa,
      password_absent: state.password_absent,
    });
  }

  /**
   * Create an MFA ticket
   * @param params Factor; for a passkey, the result of a ceremony started
   * with `client.passkeys.assertStart`
   * @returns Token
   */
  async createTicket(params: MFATicketResponse): Promise<MFATicket> {
    return new MFATicket(
      this.#client,
      await this.#client.api.put(
        "/auth/mfa/ticket",
        // The route is in stoat-api's tables, so the body is sent as given;
        // only its published type lacks the passkey factor.
        params as MFAResponse,
      ),
      this.#store[1],
    );
  }

  /**
   * Enable authenticator using token generated from secret found earlier
   * @param token Token
   */
  async enableAuthenticator(token: string): Promise<void> {
    await this.#client.api.put("/auth/mfa/totp", { totp_code: token });
    this.#store[1]("totp_mfa", true);
  }
}

/**
 * MFA Ticket
 */
export class MFATicket {
  #client: Client;
  #ticket: TicketType;
  #mutate: SetStoreFunction<MFAStatus>;
  #used = false;

  /**
   * Construct MFA Ticket
   * @param client Client
   * @param ticket Ticket
   * @param mutate Mutate the store
   */
  constructor(
    client: Client,
    ticket: TicketType,
    mutate: SetStoreFunction<MFAStatus>,
  ) {
    this.#client = client;
    this.#ticket = ticket;
    this.#mutate = mutate;
  }

  /**
   * Token
   */
  get token(): string {
    return this.#ticket.token;
  }

  /**
   * Use the ticket
   */
  #consume(): void {
    if (this.#used) throw "Already used this ticket!";
    this.#used = true;
  }

  /**
   * Fetch recovery codes
   * @returns List of codes
   */
  fetchRecoveryCodes(): Promise<string[]> {
    this.#consume();
    return this.#client.api.post("/auth/mfa/recovery", undefined, {
      headers: {
        "X-MFA-Ticket": this.token,
      },
    });
  }

  /**
   * Generate new set of recovery codes
   * @returns List of codes
   */
  async generateRecoveryCodes(): Promise<string[]> {
    this.#consume();

    const codes = await this.#client.api.patch(
      "/auth/mfa/recovery",
      undefined,
      {
        headers: {
          "X-MFA-Ticket": this.token,
        },
      },
    );

    this.#mutate("recovery_active", true);
    return codes;
  }

  /**
   * Generate new authenticator secret
   * @returns Secret
   */
  async generateAuthenticatorSecret(): Promise<string> {
    this.#consume();
    return (
      await this.#client.api.post("/auth/mfa/totp", undefined, {
        headers: {
          "X-MFA-Ticket": this.token,
        },
      })
    ).secret;
  }

  /**
   * Disable authenticator
   */
  async disableAuthenticator(): Promise<void> {
    this.#consume();

    await this.#client.api.delete("/auth/mfa/totp", undefined, {
      headers: {
        "X-MFA-Ticket": this.token,
      },
    });

    this.#mutate("totp_mfa", false);
  }

  /**
   * Disable account
   */
  disableAccount(): Promise<void> {
    this.#consume();
    return this.#client.api.post("/auth/account/disable", undefined, {
      headers: {
        "X-MFA-Ticket": this.token,
      },
    });
  }

  /**
   * Delete account
   */
  deleteAccount(): Promise<void> {
    this.#consume();
    return this.#client.api.post("/auth/account/delete", undefined, {
      headers: {
        "X-MFA-Ticket": this.token,
      },
    });
  }
}
