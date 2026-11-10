import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "@/__tests__/support/import-graph";

vi.setConfig({ testTimeout: 60_000 });

// The guard must refuse before a client exists: the URL points at a documentation
// address (TEST-NET-3) that nothing listens on, so any attempt to connect would
// print the host line first and fail with exit 3, not 1.
const UNREACHABLE_URL = "postgresql://seed:secret@203.0.113.7:5432/never";

function runSeed(overrides: Record<string, string | undefined>) {
  const env = { ...process.env, ...overrides };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
  }
  return spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"],
    {
      cwd: REPO_ROOT,
      env: {
        ...env,
        // No env file at all: only the variables given here.
        DOTENV_CONFIG_PATH: "prisma/.no-such-env-file",
        DATABASE_URL_UNPOOLED: UNREACHABLE_URL,
      },
      encoding: "utf8",
      timeout: 45_000,
    },
  );
}

describe("prisma/seed.ts guard", () => {
  test.each([
    ["a host that differs from the URL's", "elsewhere.invalid"],
    ["no DEMO_SEED_DB_HOST", undefined],
  ])("refuses with %s, before connecting", (_case, host) => {
    const result = runSeed({ DEMO_SEED_DB_HOST: host });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("demo seed refused");
    expect(output).not.toContain("Database host");
    expect(output).not.toContain("203.0.113.7");
    expect(output).not.toContain("secret");
  });
});
