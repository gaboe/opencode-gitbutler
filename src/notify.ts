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
): NotificationManager {
  const pendingNotifications = new Map<string, ContextNotification[]>();

  function addNotification(
    sessionID: string | undefined,
    message: string,
  ): void {
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
    pendingNotifications.delete(rootID);

    const lines = notifications
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
