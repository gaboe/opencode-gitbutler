import { describe, test, expect } from "bun:test";

describe("hasMultiBranchHunks logic", () => {
  function hasMultiBranchHunksFromStatus(
    filePath: string,
    stacks: Array<{
      branches?: Array<{
        commits?: Array<{
          changes?: Array<{ filePath: string }>;
        }>;
      }>;
    }>,
  ): boolean {
    let branchCount = 0;
    for (const stack of stacks) {
      for (const branch of stack.branches ?? []) {
        const hasInBranch = branch.commits?.some(
          (c) => c.changes?.some((ch) => ch.filePath === filePath),
        );
        if (hasInBranch) branchCount++;
        if (branchCount > 1) return true;
      }
    }
    return false;
  }

  test("returns false when file is in zero branches", () => {
    const stacks = [
      {
        branches: [
          {
            commits: [
              { changes: [{ filePath: "other.ts" }] },
            ],
          },
        ],
      },
    ];
    expect(hasMultiBranchHunksFromStatus("target.ts", stacks)).toBe(false);
  });

  test("returns false when file is in exactly one branch", () => {
    const stacks = [
      {
        branches: [
          {
            commits: [
              { changes: [{ filePath: "target.ts" }] },
            ],
          },
          {
            commits: [
              { changes: [{ filePath: "other.ts" }] },
            ],
          },
        ],
      },
    ];
    expect(hasMultiBranchHunksFromStatus("target.ts", stacks)).toBe(false);
  });

  test("returns true when file is in two branches", () => {
    const stacks = [
      {
        branches: [
          {
            commits: [
              { changes: [{ filePath: "target.ts" }] },
            ],
          },
          {
            commits: [
              { changes: [{ filePath: "target.ts" }, { filePath: "other.ts" }] },
            ],
          },
        ],
      },
    ];
    expect(hasMultiBranchHunksFromStatus("target.ts", stacks)).toBe(true);
  });

  test("returns true when file spans branches across stacks", () => {
    const stacks = [
      {
        branches: [
          {
            commits: [
              { changes: [{ filePath: "target.ts" }] },
            ],
          },
        ],
      },
      {
        branches: [
          {
            commits: [
              { changes: [{ filePath: "target.ts" }] },
            ],
          },
        ],
      },
    ];
    expect(hasMultiBranchHunksFromStatus("target.ts", stacks)).toBe(true);
  });

  test("handles empty stacks", () => {
    expect(hasMultiBranchHunksFromStatus("target.ts", [])).toBe(false);
  });

  test("handles branches with no commits", () => {
    const stacks = [
      {
        branches: [
          { commits: [] },
          { commits: undefined },
        ],
      },
    ];
    expect(hasMultiBranchHunksFromStatus("target.ts", stacks)).toBe(false);
  });

  test("handles commits with no changes", () => {
    const stacks = [
      {
        branches: [
          {
            commits: [
              { changes: undefined },
              { changes: [] },
            ],
          },
        ],
      },
    ];
    expect(hasMultiBranchHunksFromStatus("target.ts", stacks)).toBe(false);
  });
});

describe("after-edit routing guard", () => {
  function shouldAutoRub(branchInfo: {
    inBranch: boolean;
    unassignedCliId?: string;
    branchCliId?: string;
  }): boolean {
    return Boolean(
      branchInfo.inBranch &&
        branchInfo.unassignedCliId &&
        branchInfo.branchCliId,
    );
  }

  test("does not auto-rub when branch attribution is ambiguous", () => {
    expect(
      shouldAutoRub({
        inBranch: true,
        unassignedCliId: "u1",
      }),
    ).toBe(false);
  });

  test("auto-rubs only when both source and destination are known", () => {
    expect(
      shouldAutoRub({
        inBranch: true,
        unassignedCliId: "u1",
        branchCliId: "br1",
      }),
    ).toBe(true);
  });
});
