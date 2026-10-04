#!/usr/bin/env node
import { program } from "commander";
import { runPackageLock } from "../package-lock.ts";

program
  .name("workspace-package-lock")
  .description(
    "Review, recreate, or commit the root workspace package-lock.json.",
  )
  .option(
    "-d, --dry-run",
    "Preview lockfile changes and restore the original file",
  )
  .option("-j, --json", "Print the operation result as JSON")
  .option("-c, --commit", "Commit and push package-lock.json when it changes")
  .option("--branch <branch>", "Explicit branch to push when --commit is used")
  .action((options) => {
    runPackageLock(options);
  });

await program.parseAsync();
