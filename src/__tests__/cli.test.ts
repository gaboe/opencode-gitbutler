import { describe, expect, test } from "bun:test";
import { createCli, type ButStatusFull } from "../cli.js";
import type { Logger } from "../logger.js";

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeCli(inferenceEnabled = true) {
  return createCli("/tmp/opencode-gitbutler", noopLogger, {
    inferenceEnabled,
  });
}

describe("findFileBranch", () => {
  test("returns branch metadata when file is in committed changes", () => {
    const cli = makeCli();
    const status: ButStatusFull = {
      unassignedChanges: [
        { cliId: "u1", filePath: "src/foo.ts" },
      ],
      stacks: [
        {
          branches: [
            {
              cliId: "br1",
              name: "feature/foo",
              branchStatus: "completelyUnpushed",
              commits: [
                {
                  cliId: "c1",
                  commitId: "abc123",
                  message: "feat: foo",
                  changes: [
                    { filePath: "src/foo.ts" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = cli.findFileBranch("src/foo.ts", status);
    expect(result).toEqual({
      inBranch: true,
      branchCliId: "br1",
      branchName: "feature/foo",
      unassignedCliId: "u1",
      confidence: "high",
    });
  });

  test("infers branch for assignedChanges with a single branch in stack", () => {
    const cli = makeCli();
    const status: ButStatusFull = {
      stacks: [
        {
          assignedChanges: [
            { filePath: "src/new-file.ts" },
          ],
          branches: [
            {
              cliId: "br-single",
              name: "feature/single",
              branchStatus: "completelyUnpushed",
              commits: [],
            },
          ],
        },
      ],
    };

    const result = cli.findFileBranch("src/new-file.ts", status);
    expect(result).toEqual({
      inBranch: true,
      branchCliId: "br-single",
      branchName: "feature/single",
      confidence: "high",
    });
  });

  test("infers branch by directory prefix when multiple branches exist", () => {
    const cli = makeCli();
    const status: ButStatusFull = {
      stacks: [
        {
          assignedChanges: [
            { filePath: "apps/web/src/ui/new-button.tsx" },
          ],
          branches: [
            {
              cliId: "br-ui",
              name: "feature/ui",
              branchStatus: "completelyUnpushed",
              commits: [
                {
                  cliId: "c-ui",
                  commitId: "ui123",
                  message: "feat: ui",
                  changes: [
                    { filePath: "apps/web/src/ui/card.tsx" },
                  ],
                },
              ],
            },
            {
              cliId: "br-db",
              name: "feature/db",
              branchStatus: "completelyUnpushed",
              commits: [
                {
                  cliId: "c-db",
                  commitId: "db123",
                  message: "feat: db",
                  changes: [
                    { filePath: "packages/db/schema.ts" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = cli.findFileBranch(
      "apps/web/src/ui/new-button.tsx",
      status,
    );
    expect(result).toEqual({
      inBranch: true,
      branchCliId: "br-ui",
      branchName: "feature/ui",
      confidence: "medium",
    });
  });

  test("returns ambiguous when multi-branch scores tie", () => {
    const cli = makeCli();
    const status: ButStatusFull = {
      stacks: [
        {
          assignedChanges: [
            { filePath: "apps/web/src/shared/new.tsx" },
          ],
          branches: [
            {
              cliId: "br-a",
              name: "feature/a",
              branchStatus: "completelyUnpushed",
              commits: [
                {
                  cliId: "c-a",
                  commitId: "a123",
                  message: "feat: a",
                  changes: [
                    { filePath: "apps/web/src/ui/card.tsx" },
                  ],
                },
              ],
            },
            {
              cliId: "br-b",
              name: "feature/b",
              branchStatus: "completelyUnpushed",
              commits: [
                {
                  cliId: "c-b",
                  commitId: "b123",
                  message: "feat: b",
                  changes: [
                    { filePath: "apps/web/src/lib/util.ts" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = cli.findFileBranch("apps/web/src/shared/new.tsx", status);
    expect(result).toEqual({
      inBranch: true,
      confidence: "ambiguous",
    });
  });

  test("keeps legacy behavior for assignedChanges when inference is disabled", () => {
    const cli = makeCli(false);
    const status: ButStatusFull = {
      stacks: [
        {
          assignedChanges: [
            { filePath: "src/inferred.ts" },
          ],
          branches: [
            {
              cliId: "br-off",
              name: "feature/off",
              branchStatus: "completelyUnpushed",
              commits: [],
            },
          ],
        },
      ],
    };

    const result = cli.findFileBranch("src/inferred.ts", status);
    expect(result).toEqual({
      inBranch: true,
      confidence: "ambiguous",
    });
  });
});
