import type { Logger } from "./logger.js";

export type HookInput = {
  tool?: string;
  sessionID?: string;
  callID?: string;
};

export type HookOutput = {
  title?: string;
  output?: string;
  metadata?: Record<string, unknown>;
};

export type EventPayload = Record<string, unknown> & {
  type?: string;
  properties?: Record<string, unknown>;
};

export type BranchOwnership = {
  rootSessionID: string;
  branchName: string;
  firstSeen: number;
};

export type PluginState = {
  conversationsWithEdits: string[];
  rewordedBranches: string[];
  branchOwnership: Record<string, BranchOwnership>;
};

export const SUBAGENT_TOOLS = new Set([
  "agent",
  "task",
  "delegate_task",
]);

export type StateManager = {
  loadPluginState: () => Promise<PluginState>;
  savePluginState: (
    conversations: Set<string>,
    reworded: Set<string>,
    ownership: Map<string, BranchOwnership>,
  ) => Promise<void>;
  loadSessionMap: () => Promise<Map<string, string>>;
  saveSessionMap: (map: Map<string, string>) => Promise<void>;
  resolveSessionRoot: (sessionID: string | undefined) => string;
  trackSubagentMapping: (input: HookInput, output?: HookOutput) => Promise<void>;
  trackSessionCreatedMapping: (event: EventPayload) => Promise<void>;
  parentSessionByTaskSession: Map<string, string>;
};

export function createStateManager(
  cwd: string,
  log: Logger,
): StateManager {
  const SESSION_MAP_PATH = `${cwd}/.opencode/plugin/session-map.json`;
  const PLUGIN_STATE_PATH = `${cwd}/.opencode/plugin/plugin-state.json`;

  const parentSessionByTaskSession = new Map<string, string>();

  async function loadPluginState(): Promise<PluginState> {
    try {
      const file = Bun.file(PLUGIN_STATE_PATH);
      if (!(await file.exists()))
        return {
          conversationsWithEdits: [],
          rewordedBranches: [],
          branchOwnership: {},
        };
      const state = (await file.json()) as PluginState;
      return {
        ...state,
        branchOwnership: state.branchOwnership ?? {},
      };
    } catch {
      return {
        conversationsWithEdits: [],
        rewordedBranches: [],
        branchOwnership: {},
      };
    }
  }

  async function savePluginState(
    conversations: Set<string>,
    reworded: Set<string>,
    ownership: Map<string, BranchOwnership>,
  ): Promise<void> {
    const state: PluginState = {
      conversationsWithEdits: [...conversations],
      rewordedBranches: [...reworded],
      branchOwnership: Object.fromEntries(ownership),
    };
    await Bun.write(
      PLUGIN_STATE_PATH,
      JSON.stringify(state, null, 2) + "\n",
    );
  }

  async function loadSessionMap(): Promise<
    Map<string, string>
  > {
    try {
      const file = Bun.file(SESSION_MAP_PATH);
      if (!(await file.exists())) return new Map();
      const data = (await file.json()) as Record<
        string,
        string
      >;
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }

  async function saveSessionMap(
    map: Map<string, string>,
  ): Promise<void> {
    await Bun.write(
      SESSION_MAP_PATH,
      JSON.stringify(Object.fromEntries(map), null, 2) +
        "\n",
    );
  }

  function resolveSessionRoot(
    sessionID: string | undefined,
  ): string {
    if (!sessionID) return "opencode-default";

    const seen = new Set<string>();
    let current = sessionID;

    while (true) {
      if (seen.has(current)) return current;
      seen.add(current);

      const parent =
        parentSessionByTaskSession.get(current);
      if (!parent) return current;

      current = parent;
    }
  }

  async function trackSubagentMapping(
    input: HookInput,
    output?: HookOutput,
  ): Promise<void> {
    const tool = input.tool;
    const parentSessionID = input.sessionID;
    const taskCallID = input.callID;

    if (!tool || !SUBAGENT_TOOLS.has(tool)) return;
    if (!parentSessionID) return;

    // Map callID → parentSessionID (tool call level)
    if (taskCallID) {
      parentSessionByTaskSession.set(
        taskCallID,
        parentSessionID,
      );
    }

    // Map execution sessionId → parentSessionID (session level)
    // OpenCode task tool returns metadata.sessionId with the actual
    // execution session ID that will appear in subsequent hook calls
    const metadata = output?.metadata;
    const executionSessionId =
      typeof metadata?.sessionId === "string"
        ? metadata.sessionId
        : typeof metadata?.session_id === "string"
          ? metadata.session_id
          : undefined;

    if (executionSessionId && executionSessionId !== parentSessionID) {
      parentSessionByTaskSession.set(
        executionSessionId,
        parentSessionID,
      );
      log.info("session-map-execution", {
        executionSession: executionSessionId,
        parent: parentSessionID,
        callID: taskCallID,
      });
    }

    try {
      await saveSessionMap(parentSessionByTaskSession);
    } catch (err) {
      log.warn("session-map-save-failed", {
        task: taskCallID,
        parent: parentSessionID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    log.info("session-map-subagent", {
      task: taskCallID,
      parent: parentSessionID,
    });
  }

  async function trackSessionCreatedMapping(
    event: EventPayload,
  ): Promise<void> {
    if (event.type !== "session.created") return;

    const properties = event.properties;
    if (!properties) return;

    // OpenCode SDK: { properties: { info: { id, parentID } } }
    const info = properties.info as
      | { id?: string; parentID?: string }
      | undefined;

    const sessionID =
      (typeof info?.id === "string" ? info.id : undefined) ??
      (typeof properties.id === "string"
        ? properties.id
        : undefined);
    const parentSessionID =
      (typeof info?.parentID === "string" ? info.parentID : undefined) ??
      (typeof properties.parentSessionID === "string"
        ? properties.parentSessionID
        : typeof properties.parent_session_id === "string"
          ? properties.parent_session_id
          : undefined);

    if (!sessionID || !parentSessionID) return;

    parentSessionByTaskSession.set(
      sessionID,
      parentSessionID,
    );
    try {
      await saveSessionMap(parentSessionByTaskSession);
    } catch (err) {
      log.warn("session-map-save-failed", {
        session: sessionID,
        parent: parentSessionID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    log.info("session-map-created", {
      session: sessionID,
      parent: parentSessionID,
    });
  }

  return {
    loadPluginState,
    savePluginState,
    loadSessionMap,
    saveSessionMap,
    resolveSessionRoot,
    trackSubagentMapping,
    trackSessionCreatedMapping,
    parentSessionByTaskSession,
  };
}
