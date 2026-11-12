import { defineConfig, devices } from "@playwright/test";
import { demoSeedEnvSchema } from "@/lib/schemas/bootstrap";
import { E2E_ORIGIN, E2E_VIEWPORT, testEnv } from "./e2e/support/env";
import { hostOf } from "./scripts/lib/host";

// `npm run e2e` — the main lending journey in Chromium against its own
// `next dev` on port 3100 and `.env.test`'s database. Before the first run:
//   npm install
//   npx playwright install chromium
//   DOTENV_CONFIG_PATH=.env.test npx prisma migrate deploy
//   DOTENV_CONFIG_PATH=.env.test npm run db:seed
// Stop your own `npm run dev` first: one `next dev` per directory holds
// `.next/dev/lock`, and `.env` points at a different database. If a Next
// child still holds port 3100 afterwards (Windows), find it with
// `netstat -ano | grep LISTENING | grep ":3100 "` and end it with
// `taskkill //PID <pid> //T //F`.

// Checked here, before the web server starts (it starts before globalSetup).
const guard = demoSeedEnvSchema.safeParse(testEnv);
if (!guard.success) {
  throw new Error(
    `e2e refused: DEMO_SEED_DB_HOST in .env.test must name the test database host (${hostOf(testEnv.DATABASE_URL_UNPOOLED ?? "")}).`,
  );
}

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  // First compiles under Turbopack are slow.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
    viewport: E2E_VIEWPORT,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: E2E_VIEWPORT },
    },
  ],
  // `next dev`, not a build: only `next dev` serves the disk driver's uploads.
  webServer: {
    command: "npx next dev --port 3100",
    url: `${E2E_ORIGIN}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...testEnv, APP_URL: E2E_ORIGIN },
  },
});
