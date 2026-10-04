#!/usr/bin/env node
import { Argument, program } from "commander";
import { runDependencyCheck } from "../dependency-check.ts";

program
  .name("workspace-dependency-check")
  .description(
    "Check workspace dependencies for outdated versions and internal version mismatches.",
  )
  .addArgument(
    new Argument("[package]", "Package name, directory, or workspace selector"),
  )
  .option("-a, --all", "Check every workspace package")
  .option("-j, --json", "Output dependency check results as JSON")
  .option(
    "-n, --no-assert",
    "Report dependency failures without exiting with an error",
  )
  .option("--no-fzf", "Disable automatic fzf selection")
  .action(runDependencyCheck);

await program.parseAsync();
