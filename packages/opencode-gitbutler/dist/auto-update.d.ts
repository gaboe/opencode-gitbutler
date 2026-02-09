/**
 * Auto-update check for opencode-gitbutler.
 *
 * Queries the npm registry for the latest published version and
 * returns an update notification if a newer version is available.
 *
 * Design constraints:
 * - Never throws — all fetch/parse failures return null.
 * - No external semver dependency — uses simple numeric comparison.
 * - Non-blocking — callers should fire-and-forget.
 * - Respects config.auto_update === false to disable checks.
 */
export type UpdateInfo = {
    current: string;
    latest: string;
    updateAvailable: boolean;
};
/**
 * Check the npm registry for a newer version of opencode-gitbutler.
 *
 * @returns UpdateInfo if the check succeeds, null on any failure.
 */
export declare function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null>;
export type AutoUpdateConfig = {
    currentVersion: string;
    auto_update?: boolean;
};
export type AutoUpdateHook = {
    onSessionCreated: () => Promise<string | null>;
};
/**
 * Create an auto-update hook that checks once per plugin lifecycle.
 *
 * The returned `onSessionCreated` should be called from the event handler
 * when a new root session is created. It fires the update check on the
 * first invocation and caches the result; subsequent calls return null.
 */
export declare function createAutoUpdateHook(config: AutoUpdateConfig): AutoUpdateHook;
//# sourceMappingURL=auto-update.d.ts.map