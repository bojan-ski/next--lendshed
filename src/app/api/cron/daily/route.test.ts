import { readFileSync } from "node:fs";
import path from "node:path";
import {
  forbiddenReached,
  REPO_ROOT,
  walkImports,
} from "@/__tests__/support/import-graph";
import { runDailyJob } from "@/data/daily-job";
import type { DailyJobResult } from "@/types/daily-job";
import * as route from "./route";

const SECRET = "cron-secret-0123456789abcdefghijk";
const ROUTE = "src/app/api/cron/daily/route.ts";

const cronEnv = vi.hoisted(() => ({
  CRON_SECRET: undefined as string | undefined,
}));
vi.mock("@/lib/env/server", () => ({ env: cronEnv }));
vi.mock("@/data/daily-job", () => ({ runDailyJob: vi.fn() }));

const RESULT: DailyJobResult = {
  today: "2026-11-14",
  counts: {
    storeExpired: 1,
    storeLapsed: 0,
    retryBlobDeletions: 2,
    purgeInvitations: 0,
    purgeResetGrants: 3,
    purgeSessions: 4,
    purgeVerifications: 0,
    purgeRateLimits: 5,
  },
  failed: [],
};

const call = (authorization?: string) =>
  route.GET(
    new Request("http://localhost:3000/api/cron/daily", {
      headers: authorization === undefined ? {} : { authorization },
    }),
  );

beforeEach(() => {
  cronEnv.CRON_SECRET = SECRET;
  vi.mocked(runDailyJob).mockResolvedValue(RESULT);
});

describe("/api/cron/daily", () => {
  test("exports GET only", () => {
    expect(Object.keys(route)).toEqual(["GET"]);
  });

  test.each([
    ["the secret is unset", `Bearer ${SECRET}`, undefined],
    ["the header is missing", undefined, SECRET],
    ["Basic", `Basic ${SECRET}`, SECRET],
    ["a lower-case scheme", `bearer ${SECRET}`, SECRET],
    ["a wrong value", "Bearer wrong", SECRET],
    ["one character short", `Bearer ${SECRET.slice(0, -1)}`, SECRET],
  ])(
    "refuses %s: 401, empty body, the job never runs",
    async (_case, header, secret) => {
      cronEnv.CRON_SECRET = secret;
      const response = await call(header);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
      expect(runDailyJob).not.toHaveBeenCalled();
    },
  );

  test("a correct bearer runs the job once and answers 200 with its result", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const before = Date.now();
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...RESULT });
    expect(runDailyJob).toHaveBeenCalledTimes(1);
    const [now] = vi.mocked(runDailyJob).mock.calls[0];
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(info.mock.calls[0])).toContain(RESULT.today);
  });

  test("a run with failed steps answers 500 with ok false and the same failed list", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const failedRun: DailyJobResult = {
      ...RESULT,
      counts: { ...RESULT.counts, purgeSessions: null },
      failed: ["purgeSessions"],
    };
    vi.mocked(runDailyJob).mockResolvedValue(failedRun);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, ...failedRun });
    expect(info).not.toHaveBeenCalled();
  });
});

describe("/api/cron/daily — static", () => {
  test("reaches no session, auth library module or next/headers", () => {
    const graph = walkImports([ROUTE]);
    expect(
      forbiddenReached(graph, {
        files: (file) =>
          file.startsWith("src/lib/auth/") || file === "src/data/viewer.ts",
        packages: (specifier) => specifier === "next/headers",
      }),
    ).toEqual([]);
  });

  test("has no segment config and no cache directive", () => {
    const source = readFileSync(path.join(REPO_ROOT, ROUTE), "utf8");
    expect(source).not.toMatch(/export const (dynamic|runtime|revalidate)\b/);
    expect(source).not.toMatch(
      /use cache|cacheTag|cacheLife|revalidateTag|updateTag/,
    );
  });

  test("vercel.json holds exactly one cron: this route, daily at 02:00 UTC", () => {
    const config = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8"),
    );
    const url = `/${path.posix.dirname(ROUTE).replace(/^src\/app\//, "")}`;
    expect(config).toEqual({
      crons: [{ path: url, schedule: "0 2 * * *" }],
    });
    expect(url).toBe("/api/cron/daily");
  });
});
