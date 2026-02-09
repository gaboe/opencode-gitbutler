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

const NPM_DIST_TAGS_URL =
  "https://registry.npmjs.org/-/package/opencode-gitbutler/dist-tags";

const FETCH_TIMEOUT_MS = 5_000;

export type UpdateInfo = {
  current: string;
  latest: string;
  updateAvailable: boolean;
};

/**
 * Parse a semver-ish version string into numeric parts for comparison.
 * Handles "x.y.z", "x.y.z-beta.1", etc. Pre-release is always < release.
 * Returns null if unparseable.
 */
function parseVersion(
  version: string
): { major: number; minor: number; patch: number; prerelease: string } | null {
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

/**
 * Compare two semver-ish versions.
 * Returns:  1 if a > b,  -1 if a < b,  0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0; // unparseable → treat as equal

  for (const field of ["major", "minor", "patch"] as const) {
    if (pa[field] > pb[field]) return 1;
    if (pa[field] < pb[field]) return -1;
  }

  // Both have same major.minor.patch — compare prerelease
  // No prerelease > has prerelease (1.0.0 > 1.0.0-beta.1)
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;

  // Both have prerelease: lexicographic is good enough for our needs
  if (pa.prerelease < pb.prerelease) return -1;
  if (pa.prerelease > pb.prerelease) return 1;

  return 0;
}

/**
 * Check the npm registry for a newer version of opencode-gitbutler.
 *
 * @returns UpdateInfo if the check succeeds, null on any failure.
 */
export async function checkForUpdate(
  currentVersion: string
): Promise<UpdateInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(NPM_DIST_TAGS_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, string>;
    const latest = data.latest;
    if (!latest || typeof latest !== "string") return null;

    return {
      current: currentVersion,
      latest,
      updateAvailable: compareVersions(latest, currentVersion) > 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatUpdateMessage(info: UpdateInfo): string {
  return (
    `opencode-gitbutler update available: ${info.current} → ${info.latest}. ` +
    `Run \`bun add opencode-gitbutler@latest\` to update.`
  );
}

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
export function createAutoUpdateHook(
  config: AutoUpdateConfig
): AutoUpdateHook {
  if (config.auto_update === false) {
    return { onSessionCreated: async () => null };
  }

  let checked = false;
  let pendingMessage: string | null = null;
  let checkPromise: Promise<void> | null = null;

  checkPromise = checkForUpdate(config.currentVersion)
    .then((info) => {
      if (info?.updateAvailable) {
        pendingMessage = formatUpdateMessage(info);
      }
    })
    .catch(() => {
      // Silently ignore — update check is best-effort
    })
    .finally(() => {
      checkPromise = null;
    });

  return {
    onSessionCreated: async () => {
      if (checked) return null;
      checked = true;

      // Wait for in-flight check if still running
      if (checkPromise) {
        await checkPromise;
      }

      const msg = pendingMessage;
      pendingMessage = null;
      return msg;
    },
  };
}
