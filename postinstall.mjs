#!/usr/bin/env node

import { execSync } from "child_process";

try {
  execSync("but --version", { stdio: "pipe" });
  console.log("✓ GitButler CLI found");
} catch {
  console.warn("⚠ GitButler CLI not found. Install with: brew install gitbutler");
}
