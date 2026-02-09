import { resolve } from "node:path";

export type GitButlerPluginConfig = {
  /** Enable debug logging to .opencode/plugin/debug.log */
  log_enabled: boolean;
  /** Model ID for LLM commit message generation */
  commit_message_model: string;
  /** Provider ID for LLM commit message generation */
  commit_message_provider: string;
  /** Timeout in ms for LLM commit message generation */
  llm_timeout_ms: number;
  /** Maximum characters of diff to send to LLM */
  max_diff_chars: number;
  /** Maximum length of generated branch slug */
  branch_slug_max_length: number;
  /** Enable automatic version update checks */
  auto_update: boolean;
  /** Regex pattern string for default branch names (will be compiled to RegExp) */
  default_branch_pattern: string;
};

export const DEFAULT_CONFIG: Readonly<GitButlerPluginConfig> = {
  log_enabled: true,
  commit_message_model: "claude-haiku-4-5",
  commit_message_provider: "anthropic",
  llm_timeout_ms: 15_000,
  max_diff_chars: 4_000,
  branch_slug_max_length: 50,
  auto_update: true,
  default_branch_pattern: "^ge-branch-\\d+$",
};

const CONFIG_FILE_NAME = ".opencode/gitbutler.json";

/**
 * Strip JSONC comments and trailing commas so the result is valid JSON.
 * Tracks quote state to avoid stripping inside string literals.
 */
export function stripJsonComments(input: string): string {
  let result = "";
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i]!;

    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (input[j] === "\\") {
          j += 2;
          continue;
        }
        if (input[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      result += input.slice(i, j);
      i = j;
      continue;
    }

    if (ch === "/" && i + 1 < len && input[i + 1] === "/") {
      i += 2;
      while (i < len && input[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && i + 1 < len && input[i + 1] === "*") {
      const closeIdx = input.indexOf("*/", i + 2);
      i = closeIdx !== -1 ? closeIdx + 2 : len;
      continue;
    }

    result += ch;
    i++;
  }

  result = result.replace(/,\s*([\]}])/g, "$1");

  return result;
}

function isValidRegex(pattern: unknown): pattern is string {
  if (typeof pattern !== "string") return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(
  cwd: string
): Promise<GitButlerPluginConfig> {
  const configPath = resolve(cwd, CONFIG_FILE_NAME);

  try {
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
      return { ...DEFAULT_CONFIG };
    }

    const raw = await file.text();
    const cleaned = stripJsonComments(raw);
    const parsed = JSON.parse(cleaned) as Partial<GitButlerPluginConfig>;

    return {
      log_enabled: typeof parsed.log_enabled === "boolean"
        ? parsed.log_enabled
        : DEFAULT_CONFIG.log_enabled,
      commit_message_model: typeof parsed.commit_message_model === "string"
        ? parsed.commit_message_model
        : DEFAULT_CONFIG.commit_message_model,
      commit_message_provider: typeof parsed.commit_message_provider === "string"
        ? parsed.commit_message_provider
        : DEFAULT_CONFIG.commit_message_provider,
      llm_timeout_ms: typeof parsed.llm_timeout_ms === "number" && parsed.llm_timeout_ms > 0
        ? parsed.llm_timeout_ms
        : DEFAULT_CONFIG.llm_timeout_ms,
      max_diff_chars: typeof parsed.max_diff_chars === "number" && parsed.max_diff_chars > 0
        ? parsed.max_diff_chars
        : DEFAULT_CONFIG.max_diff_chars,
      branch_slug_max_length: typeof parsed.branch_slug_max_length === "number" && parsed.branch_slug_max_length > 0
        ? parsed.branch_slug_max_length
        : DEFAULT_CONFIG.branch_slug_max_length,
      auto_update: typeof parsed.auto_update === "boolean"
        ? parsed.auto_update
        : DEFAULT_CONFIG.auto_update,
      default_branch_pattern: isValidRegex(parsed.default_branch_pattern)
        ? parsed.default_branch_pattern
        : DEFAULT_CONFIG.default_branch_pattern,
    };
  } catch (err) {
    console.warn(
      `[opencode-gitbutler] Failed to parse config at ${configPath}: ${err instanceof Error ? err.message : String(err)}. Using defaults.`
    );
    return { ...DEFAULT_CONFIG };
  }
}
