#!/usr/bin/env node
import { Argument, Option, program } from "commander";
import { releaseWorkspacePackage } from "../release.ts";

program
  .name("workspace-release")
  .description("Preview or create a workspace package release.")
  .addArgument(
    new Argument(
      "[release]",
      "Package selector or package=version, for example workspace-tools or workspace-tools=patch",
    ),
  )
  .addOption(
    new Option("--mode <mode>", "Version mode").choices([
      "bump",
      "exact",
      "package-json",
    ]),
  )
  .option("--version <version>", "Override the version or bump")
  .option("-d, --dry-run", "Preview without changing repository files")
  .option("-j, --json", "Print the operation result as JSON")
  .option("--no-fzf", "Disable automatic fzf selection")
  .action(async (release, options) => {
    await releaseWorkspacePackage(release, options);
  });

await program.parseAsync();
