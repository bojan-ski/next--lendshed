const VALID_SERVER = {
  DATABASE_URL: "postgresql://user:secret-pooled@pooler.example.test/db",
  DATABASE_URL_UNPOOLED:
    "postgresql://user:secret-direct@direct.example.test/db",
  COMMUNITY_NAME: "Elm Street",
};

function stubServerEnv(
  overrides: Partial<
    Record<keyof typeof VALID_SERVER, string | undefined>
  > = {},
) {
  for (const [name, value] of Object.entries({
    ...VALID_SERVER,
    ...overrides,
  })) {
    vi.stubEnv(name, value);
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server env", () => {
  test("valid input parses", async () => {
    stubServerEnv();
    const { env } = await import("./env");
    expect(env.COMMUNITY_NAME).toBe("Elm Street");
    expect(env.DATABASE_URL).toBe(VALID_SERVER.DATABASE_URL);
    expect(env.DATABASE_URL_UNPOOLED).toBe(VALID_SERVER.DATABASE_URL_UNPOOLED);
  });

  test("trims COMMUNITY_NAME", async () => {
    stubServerEnv({ COMMUNITY_NAME: "  Elm Street  " });
    const { env } = await import("./env");
    expect(env.COMMUNITY_NAME).toBe("Elm Street");
  });

  test.each([
    ["missing COMMUNITY_NAME", { COMMUNITY_NAME: undefined }, "COMMUNITY_NAME"],
    ["blank COMMUNITY_NAME", { COMMUNITY_NAME: "   " }, "COMMUNITY_NAME"],
    ["non-URL DATABASE_URL", { DATABASE_URL: "not a url" }, "DATABASE_URL"],
    [
      "missing DATABASE_URL_UNPOOLED",
      { DATABASE_URL_UNPOOLED: undefined },
      "DATABASE_URL_UNPOOLED",
    ],
  ])(
    "rejects %s, naming the variable but no value",
    async (_case, overrides, name) => {
      stubServerEnv(overrides);
      const failure = import("./env");
      await expect(failure).rejects.toThrow(name);
      const message = await failure.catch((error: Error) => error.message);
      expect(message).not.toContain("secret-pooled");
      expect(message).not.toContain("secret-direct");
      expect(message).not.toContain("not a url");
    },
  );
});

describe("public env", () => {
  test("valid input parses", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", "Lendshed");
    const { publicEnv } = await import("./public-env");
    expect(publicEnv.NEXT_PUBLIC_APP_NAME).toBe("Lendshed");
  });

  test("rejects a missing NEXT_PUBLIC_APP_NAME by name", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", undefined);
    await expect(import("./public-env")).rejects.toThrow(
      "NEXT_PUBLIC_APP_NAME",
    );
  });
});
