import { execFileSync } from "node:child_process";
import path from "node:path";
import { testEnvValue } from "./env";

// Playwright transpiles to CommonJS, where the generated Prisma client
// (`import.meta.url`) can't load, so each database step runs in a tsx child,
// the loader the CLI scripts use. The direct URL goes to the child's env only.
export function callDb<T>(command: string, args: Record<string, unknown>): T {
  const entry = path.join(process.cwd(), "e2e", "support", "db-cli.ts");
  try {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", entry, command, JSON.stringify(args)],
      {
        env: {
          ...process.env,
          DATABASE_URL_UNPOOLED: testEnvValue("DATABASE_URL_UNPOOLED"),
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    return JSON.parse(output) as T;
  } catch {
    throw new Error(
      `The e2e database step "${command}" failed; its reason is printed above.`,
    );
  }
}
