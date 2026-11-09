import { parseEnv } from "@/lib/env/parse";
import { demoSeedEnvSchema, organizerBootstrapEnvSchema } from "./bootstrap";

const URL_VALUE = "postgresql://user:hunter2-secret@db.example.test/app";
const PASSWORD = "correct-horse-battery";

const valid = {
  DATABASE_URL_UNPOOLED: URL_VALUE,
  ORGANIZER_NAME: "Ruth K.",
  ORGANIZER_EMAIL: "ruth@example.com",
  ORGANIZER_PASSWORD: PASSWORD,
};

function failingNames(input: Record<string, unknown>): string[] {
  const result = organizerBootstrapEnvSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success
    ? []
    : [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
}

describe("organizerBootstrapEnvSchema", () => {
  test("accepts valid input, normalises the email and keeps the password as given", () => {
    const parsed = organizerBootstrapEnvSchema.parse({
      ...valid,
      ORGANIZER_NAME: "  Ruth K.  ",
      ORGANIZER_EMAIL: "  Ruth@Example.COM ",
      ORGANIZER_PASSWORD: ` ${PASSWORD} `,
      UNRELATED: "ignored",
    });
    expect(parsed).toEqual({
      DATABASE_URL_UNPOOLED: URL_VALUE,
      ORGANIZER_NAME: "Ruth K.",
      ORGANIZER_EMAIL: "ruth@example.com",
      ORGANIZER_PASSWORD: ` ${PASSWORD} `,
    });
  });

  test("an empty environment names all four variables", () => {
    expect(failingNames({}).sort()).toEqual(
      [
        "DATABASE_URL_UNPOOLED",
        "ORGANIZER_EMAIL",
        "ORGANIZER_NAME",
        "ORGANIZER_PASSWORD",
      ].sort(),
    );
  });

  test.each([
    ["a missing name", { ORGANIZER_NAME: undefined }, "ORGANIZER_NAME"],
    ["a 1-character name", { ORGANIZER_NAME: "R" }, "ORGANIZER_NAME"],
    [
      "a name that trims to 1 character",
      { ORGANIZER_NAME: "  R  " },
      "ORGANIZER_NAME",
    ],
    [
      "a 41-character name",
      { ORGANIZER_NAME: "R".repeat(41) },
      "ORGANIZER_NAME",
    ],
    ["a bad email", { ORGANIZER_EMAIL: "not-an-email" }, "ORGANIZER_EMAIL"],
    [
      "a 9-character password",
      { ORGANIZER_PASSWORD: "123456789" },
      "ORGANIZER_PASSWORD",
    ],
    [
      "a 129-character password",
      { ORGANIZER_PASSWORD: "x".repeat(129) },
      "ORGANIZER_PASSWORD",
    ],
    [
      "an invalid URL",
      { DATABASE_URL_UNPOOLED: "not a url" },
      "DATABASE_URL_UNPOOLED",
    ],
  ])("%s fails on that variable only", (_case, override, name) => {
    expect(failingNames({ ...valid, ...override })).toEqual([name]);
  });

  test.each([
    ["2-character name", { ORGANIZER_NAME: "Ru" }],
    ["40-character name", { ORGANIZER_NAME: "R".repeat(40) }],
    ["10-character password", { ORGANIZER_PASSWORD: "1234567890" }],
    ["128-character password", { ORGANIZER_PASSWORD: "x".repeat(128) }],
  ])("accepts a %s", (_case, override) => {
    expect(
      organizerBootstrapEnvSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(true);
  });

  test("parseEnv's failure names the variables, never their values", () => {
    const run = () =>
      parseEnv(organizerBootstrapEnvSchema, {
        ...valid,
        ORGANIZER_EMAIL: "leaked@nowhere",
        ORGANIZER_PASSWORD: "short",
      });
    expect(run).toThrow(/ORGANIZER_EMAIL, ORGANIZER_PASSWORD/);
    let message = "";
    try {
      run();
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    for (const value of [
      "leaked@nowhere",
      "short",
      "hunter2-secret",
      "db.example.test",
    ]) {
      expect(message).not.toContain(value);
    }
  });
});

describe("demoSeedEnvSchema", () => {
  test.each([
    ["the URL's host", "db.example.test"],
    ["the host in another case, padded", "  DB.Example.TEST "],
  ])("accepts %s", (_case, host) => {
    expect(
      demoSeedEnvSchema.safeParse({
        DATABASE_URL_UNPOOLED: URL_VALUE,
        DEMO_SEED_DB_HOST: host,
      }).success,
    ).toBe(true);
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["another database's host", "prod-db.example.test"],
    ["a host that only shares a suffix", "example.test"],
    ["the full URL instead of the host", URL_VALUE],
  ])("refuses a DEMO_SEED_DB_HOST that is %s", (_case, host) => {
    const result = demoSeedEnvSchema.safeParse({
      DATABASE_URL_UNPOOLED: URL_VALUE,
      DEMO_SEED_DB_HOST: host,
    });
    expect(result.success).toBe(false);
    expect(
      new Set(result.error?.issues.map((issue) => issue.path.join("."))),
    ).toEqual(new Set(["DEMO_SEED_DB_HOST"]));
  });

  test("a refusal names the variable, never the host or URL", () => {
    expect(() =>
      parseEnv(demoSeedEnvSchema, {
        DATABASE_URL_UNPOOLED: URL_VALUE,
        DEMO_SEED_DB_HOST: "prod-db.example.test",
      }),
    ).toThrow(/^Invalid or missing environment variables: DEMO_SEED_DB_HOST$/);
  });
});
