import type { Logger } from "./logger.js";

export type ContextNotification = {
  message: string;
  timestamp: number;
};

export type NotificationManager = {
  addNotification: (sessionID: string | undefined, message: string) => void;
  consumeNotifications: (sessionID: string) => string | null;
};

export function createNotificationManager(
  log: Logger,
  resolveSessionRoot: (sessionID: string | undefined) => string,
  maxAgeMs = 300_000,
): NotificationManager {
  const pendingNotifications = new Map<string, ContextNotification[]>();

  function reapExpired(): void {
    if (maxAgeMs <= 0) return;
    const now = Date.now();
    for (const [rootID, notifications] of pendingNotifications) {
      const expired = notifications.filter((n) => now - n.timestamp > maxAgeMs);
      if (expired.length > 0) {
        for (const n of expired) {
          log.warn("notification-expired", {
            rootID,
            message: n.message,
            ageMs: now - n.timestamp,
          });
        }
        const remaining = notifications.filter((n) => now - n.timestamp <= maxAgeMs);
        if (remaining.length === 0) {
          pendingNotifications.delete(rootID);
        } else {
          pendingNotifications.set(rootID, remaining);
        }
      }
    }
  }

  function addNotification(
    sessionID: string | undefined,
    message: string,
  ): void {
    reapExpired();
    const rootID = resolveSessionRoot(sessionID);
    const existing = pendingNotifications.get(rootID) ?? [];
    existing.push({
      message,
      timestamp: Date.now(),
    });
    pendingNotifications.set(rootID, existing);
    log.info("notification-queued", {
      rootID,
      message,
    });
  }

  function consumeNotifications(
    sessionID: string,
  ): string | null {
    const rootID = resolveSessionRoot(sessionID);
    const notifications = pendingNotifications.get(rootID);
    if (!notifications || notifications.length === 0)
      return null;

    const now = Date.now();
    const live = maxAgeMs > 0
      ? notifications.filter((n) => {
          const expired = now - n.timestamp > maxAgeMs;
          if (expired) {
            log.warn("notification-expired", {
              rootID,
              message: n.message,
              ageMs: now - n.timestamp,
            });
          }
          return !expired;
        })
      : notifications;

    pendingNotifications.delete(rootID);

    if (live.length === 0) return null;

    const lines = live
      .map((n) => `- ${n.message}`)
      .join("\n");
    return [
      "<system-reminder>",
      "[GITBUTLER STATE UPDATE]",
      "The following happened automatically since your last response:",
      "",
      lines,
      "",
      "This is informational — no action needed unless relevant to your current task.",
      "</system-reminder>",
    ].join("\n");
  }

  return { addNotification, consumeNotifications };
}
