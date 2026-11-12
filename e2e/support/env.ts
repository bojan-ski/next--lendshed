import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

export const E2E_ORIGIN = "http://localhost:3100";
export const E2E_VIEWPORT = { width: 1280, height: 800 };

// `.env.test` parsed into a plain object: it goes to the web server and the
// database child, never into the runner's own process.env.
export const testEnv: Readonly<Record<string, string>> = Object.freeze(
  parse(readFileSync(path.join(process.cwd(), ".env.test"))),
);

export function testEnvValue(key: string): string {
  const value = testEnv[key];
  if (!value) throw new Error(`.env.test does not set ${key}.`);
  return value;
}
