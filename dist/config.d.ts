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
export declare const DEFAULT_CONFIG: Readonly<GitButlerPluginConfig>;
/**
 * Strip JSONC comments and trailing commas so the result is valid JSON.
 * Tracks quote state to avoid stripping inside string literals.
 */
export declare function stripJsonComments(input: string): string;
export declare function loadConfig(cwd: string): Promise<GitButlerPluginConfig>;
//# sourceMappingURL=config.d.ts.map