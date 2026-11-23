/**
 * Which methods an account can create an MFA ticket with, from its MFA
 * status.
 *
 * Pure: no Client, Solid or storage imports, so specs load it directly.
 */
import type { MFAStatus, MFATicketMethod } from "../types/passkeys.js";

/**
 * Methods the account can create an MFA ticket with, easiest first.
 *
 * A status from a server that predates passkeys gives the same list as
 * before: the authenticator app (and recovery codes) when enabled, else the
 * password. `security_key_mfa` puts `"Passkey"` first; `password_absent`
 * drops `"Password"`, which can leave the list empty.
 * @param status MFA status of the account
 * @returns Methods
 */
export function availableMfaMethods(
  status: Pick<
    MFAStatus,
    "totp_mfa" | "recovery_active" | "security_key_mfa" | "password_absent"
  >,
): MFATicketMethod[] {
  const methods: MFATicketMethod[] = status.totp_mfa
    ? status.recovery_active
      ? ["Totp", "Recovery"]
      : ["Totp"]
    : ["Password"];

  // Strictly `true`: anything else is a server that does not report it
  const known =
    status.password_absent === true
      ? methods.filter((method) => method !== "Password")
      : methods;

  return status.security_key_mfa === true ? ["Passkey", ...known] : known;
}
