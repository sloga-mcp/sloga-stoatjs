/**
 * Return a version of a server event that is safe to write to the debug log.
 *
 * UserMoveVoiceChannel carries a LiveKit access token (a bearer credential
 * for this device on the SFU), so the log gets a shallow copy with the token
 * replaced. Bulk wrappers are checked item by item. The input is never
 * modified: the original event, token included, is what gets dispatched.
 * Every other event is returned as-is.
 * @param event Parsed server event
 * @returns Value to log
 */
export function redactEventForLog(event: unknown): unknown {
  if (typeof event !== "object" || event === null) return event;
  const { type } = event as { type?: unknown };

  if (type === "UserMoveVoiceChannel") {
    const { token } = event as { token?: unknown };
    if (token !== undefined) return { ...event, token: "[redacted]" };
  } else if (type === "Bulk") {
    const { v } = event as { v?: unknown };
    if (Array.isArray(v)) {
      const items = v.map(redactEventForLog);
      if (items.some((item, i) => item !== v[i])) return { ...event, v: items };
    }
  }

  return event;
}
