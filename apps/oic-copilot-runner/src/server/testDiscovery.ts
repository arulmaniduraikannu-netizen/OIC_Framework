import fs from "node:fs/promises";
import path from "node:path";
import { settings } from "./config.js";

export interface ExistingTestCaseMatch {
  filePath: string;
  relativePath: string;
  className: string;
  methodName: string;
  fullyQualifiedName: string;
}

export async function findExistingTestCase(testCaseId: string): Promise<ExistingTestCaseMatch | undefined> {
  const testsRoot = path.join(settings.repoRoot, "src", "test", "java");
  const files = await listFiles(testsRoot);
  const idRegex = new RegExp(`TC#?${escapeRegExp(testCaseId)}\\b`, "i");

  for (const filePath of files.filter((file) => file.endsWith(".java"))) {
    const content = await fs.readFile(filePath, "utf8");
    if (!idRegex.test(content)) {
      continue;
    }

    const packageName = content.match(/package\s+([A-Za-z0-9_.]+)\s*;/)?.[1] ?? "com.oracle.oic.tests";
    const className = content.match(/class\s+([A-Za-z0-9_]+)/)?.[1];
    // Only accept a match where the id is authoritatively tied to a @Test method
    // (in its name or its description attribute) — never a stray comment.
    const methodName = findAuthoritativeTestMethod(content, testCaseId);

    if (!className || !methodName) {
      continue;
    }

    const relativePath = path.relative(settings.repoRoot, filePath).replace(/\\/g, "/");
    return {
      filePath,
      relativePath,
      className,
      methodName,
      fullyQualifiedName: `${packageName}.${className}.${methodName}`
    };
  }

  return undefined;
}

/**
 * Returns the name of a `@Test` method that authoritatively owns the given
 * test-case id — the id must appear in the method name or in the method's
 * annotation block (`@Test`/`@Description`/`@Test(groups=...)`) that precedes it.
 * A bare comment reference elsewhere in the file does NOT count, so we never run
 * an unrelated test just because it mentions the id in a note.
 */
function findAuthoritativeTestMethod(content: string, testCaseId: string): string | undefined {
  const idRegex = new RegExp(`${escapeRegExp(testCaseId)}\\b`, "i");
  const testMethodRegex = /@Test\b([\s\S]{0,600}?)public\s+(?:static\s+)?void\s+([A-Za-z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = testMethodRegex.exec(content)) !== null) {
    const attributeBlock = match[1];
    const methodName = match[2];
    if (idRegex.test(methodName) || idRegex.test(attributeBlock)) {
      return methodName;
    }
  }
  return undefined;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
