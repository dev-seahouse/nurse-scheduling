import type { NextConfig } from "next";
import { execSync } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function getGitVersion(cwd: string = REPO_ROOT): string {
  try {
    // Try to get version from git describe (uses tags + commits)
    const command = `git -c ${JSON.stringify(`safe.directory=${cwd}`)} -C ${JSON.stringify(cwd)} describe --tags --always --dirty`;
    console.log(`Getting app version with: ${command}`);
    const version = execSync(command, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    console.log(`Resolved app version: ${version}`);
    return version;
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error
      ? String(error.stderr).trim()
      : String(error);
    console.warn(`Failed to resolve app version: ${stderr}`);
    return "v0.0.0-unknown";  // Fallback if git command fails (e.g., not a git repo)
  }
}

const appVersion = getGitVersion();
const nextConfig: NextConfig = {
  /* config options here */
  output: 'export',
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-XGDWE4SWF7',
  },
};

export default nextConfig;
