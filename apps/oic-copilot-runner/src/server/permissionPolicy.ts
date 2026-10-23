import path from "node:path";
import { paths } from "./config.js";

const allowedWriteRoots = [
  "src/main/java/com/oracle/oic/pages",
  "src/main/java/com/oracle/oic/base",
  "src/main/java/com/oracle/oic/utils",
  "src/test/java/com/oracle/oic/tests",
  "src/test/java/com/oracle/oic/base",
  "src/test/resources/testdata",
  ".github/oic-knowledge.md",
  ".github/test-failure-log.md",
  "apps/oic-copilot-runner/data"
];

const allowedCommandPatterns = [
  /^Get-Location$/i,
  /^Get-ChildItem\s+-Path\s+.*src\\(main|test)\\java\b.*/i,
  /^mvn\s+(?:-q\s+)?(?:-DskipTests\s+)?compile\b/i,
  /^mvn\s+test\b/i,
  /^npx\s+playwright\s+install\b/i
];

const deniedCommandPatterns = [
  /\bgit\s+(push|reset|checkout|clean|rebase|branch\s+-d|branch\s+-D)\b/i,
  /\b(git\s+commit\s+--no-verify|Remove-Item\s+-Recurse|rm\s+-rf)\b/i,
  /\b(npm|pnpm|yarn)\s+(install|add|remove|update)\b/i
];

export function canWriteFile(filePath: string): boolean {
  const relativePath = toRepoRelativePath(filePath);
  return allowedWriteRoots.some((allowed) => relativePath === normalize(allowed) || relativePath.startsWith(`${normalize(allowed)}/`));
}

export function canRunCommand(command: string): boolean {
  if (deniedCommandPatterns.some((pattern) => pattern.test(command))) {
    return false;
  }
  return allowedCommandPatterns.some((pattern) => pattern.test(command.trim()));
}

export function toRepoRelativePath(filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(paths.repoRoot, filePath);
  return normalize(path.relative(paths.repoRoot, absolute));
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
