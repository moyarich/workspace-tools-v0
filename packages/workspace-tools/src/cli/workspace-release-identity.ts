#!/usr/bin/env node
import { Argument, Option, program } from "commander";
import { releaseIdentity } from "../release-identity.ts";
import { packageInfo, repositoryRoot } from "../workspace.ts";

program
  .name("workspace-release-identity")
  .description(
    "Resolve the canonical Git tag and GitHub Release name for a workspace package.",
  )
  .addArgument(new Argument("<package>", "Workspace package selector"))
  .addOption(
    new Option(
      "--version <version>",
      "Version or release-template token to use",
    ),
  )
  .option("--json", "Print compact JSON")
  .option("--pretty-json", "Print formatted JSON")
  .action((selector, options) => {
    const pkg = packageInfo(repositoryRoot(), selector);
    const identity = releaseIdentity(
      pkg,
      options.version ?? pkg.manifest.version,
    );

    if (options.json) process.stdout.write(JSON.stringify(identity));
    else if (options.prettyJson)
      process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    else {
      process.stdout.write(
        [
          `Package: ${identity.packageName}`,
          `Directory: ${identity.packageDirectory}`,
          `Version: ${identity.version}`,
          `Tag: ${identity.tagName}`,
          `Release: ${identity.releaseName}`,
          "",
        ].join("\n"),
      );
    }
  });

await program.parseAsync();
