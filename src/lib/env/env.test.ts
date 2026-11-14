const VALID_SERVER = {
  DATABASE_URL: "postgresql://user:secret-pooled@pooler.example.test/db",
  DATABASE_URL_UNPOOLED:
    "postgresql://user:secret-direct@direct.example.test/db",
  COMMUNITY_NAME: "Elm Street",
  AUTH_SECRET: "secret-auth-0123456789abcdefghijklmnop",
  APP_URL: "http://localhost:3000",
  STORAGE_DRIVER: "disk",
  BLOB_READ_WRITE_TOKEN: "",
  BLOB_PUBLIC_HOST: "",
  CRON_SECRET: undefined as string | undefined,
  VERCEL: undefined as string | undefined,
};

const CRON_SECRET = "cron-secret-0123456789abcdefghijk";

const BLOB = {
  STORAGE_DRIVER: "blob",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_secret-token",
  BLOB_PUBLIC_HOST: "abc123.public.blob.vercel-storage.com",
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
    const { env } = await import("./server");
    expect(env.COMMUNITY_NAME).toBe("Elm Street");
    expect(env.DATABASE_URL).toBe(VALID_SERVER.DATABASE_URL);
    expect(env.DATABASE_URL_UNPOOLED).toBe(VALID_SERVER.DATABASE_URL_UNPOOLED);
    expect(env.AUTH_SECRET).toBe(VALID_SERVER.AUTH_SECRET);
    expect(env.APP_URL).toBe(VALID_SERVER.APP_URL);
  });

  test("trims COMMUNITY_NAME", async () => {
    stubServerEnv({ COMMUNITY_NAME: "  Elm Street  " });
    const { env } = await import("./server");
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
    ["missing AUTH_SECRET", { AUTH_SECRET: undefined }, "AUTH_SECRET"],
    [
      "31-character AUTH_SECRET",
      { AUTH_SECRET: "secret-auth-0123456789abcdefghi" },
      "AUTH_SECRET",
    ],
    ["non-URL APP_URL", { APP_URL: "not a url" }, "APP_URL"],
  ])(
    "rejects %s, naming the variable but no value",
    async (_case, overrides, name) => {
      stubServerEnv(overrides);
      const failure = import("./server");
      await expect(failure).rejects.toThrow(name);
      const message = await failure.catch((error: Error) => error.message);
      expect(message).not.toContain("secret-pooled");
      expect(message).not.toContain("secret-direct");
      expect(message).not.toContain("not a url");
      expect(message).not.toContain("secret-auth");
    },
  );
});

describe("server env — photo storage", () => {
  test("disk alone parses, with the empty Blob keys of .env.example as absent", async () => {
    stubServerEnv();
    const { env } = await import("./server");
    expect(env.STORAGE_DRIVER).toBe("disk");
    expect(env.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    expect(env.BLOB_PUBLIC_HOST).toBeUndefined();
  });

  test("blob with a token and a public host parses", async () => {
    stubServerEnv({ ...BLOB, VERCEL: "1", CRON_SECRET });
    const { env } = await import("./server");
    expect(env.STORAGE_DRIVER).toBe("blob");
    expect(env.BLOB_PUBLIC_HOST).toBe(BLOB.BLOB_PUBLIC_HOST);
  });

  test.each([
    [
      "a missing STORAGE_DRIVER",
      { STORAGE_DRIVER: undefined },
      "STORAGE_DRIVER",
    ],
    ["an unknown STORAGE_DRIVER", { STORAGE_DRIVER: "s3" }, "STORAGE_DRIVER"],
    ["disk on Vercel", { VERCEL: "1" }, "STORAGE_DRIVER"],
    [
      "blob without a token",
      { ...BLOB, BLOB_READ_WRITE_TOKEN: "" },
      "BLOB_READ_WRITE_TOKEN",
    ],
    [
      "blob without a host",
      { ...BLOB, BLOB_PUBLIC_HOST: undefined },
      "BLOB_PUBLIC_HOST",
    ],
    [
      "a host that isn't a public Blob host",
      {
        ...BLOB,
        BLOB_PUBLIC_HOST: "https://abc123.public.blob.vercel-storage.com",
      },
      "BLOB_PUBLIC_HOST",
    ],
  ])(
    "rejects %s, naming the variable but no value",
    async (_case, overrides, name) => {
      stubServerEnv(overrides);
      const failure = import("./server");
      await expect(failure).rejects.toThrow(name);
      const message = await failure.catch((error: Error) => error.message);
      expect(message).not.toContain("secret-token");
    },
  );
});

describe("server env — CRON_SECRET", () => {
  test.each([
    ["absent", undefined],
    ["empty, as in .env.example", ""],
  ])("%s passes off Vercel", async (_case, value) => {
    stubServerEnv({ CRON_SECRET: value });
    const { env } = await import("./server");
    expect(env.CRON_SECRET).toBeUndefined();
  });

  test("a 32-character secret is accepted", async () => {
    const exact = CRON_SECRET.slice(0, 32);
    expect(exact).toHaveLength(32);
    stubServerEnv({ CRON_SECRET: exact });
    const { env } = await import("./server");
    expect(env.CRON_SECRET).toBe(exact);
  });

  test("a 31-character secret is refused by name, without its value", async () => {
    stubServerEnv({ CRON_SECRET: CRON_SECRET.slice(0, 31) });
    const failure = import("./server");
    await expect(failure).rejects.toThrow("CRON_SECRET");
    const message = await failure.catch((error: Error) => error.message);
    expect(message).not.toContain("cron-secret");
  });

  test.each([
    ["blob", { ...BLOB, VERCEL: "1" }],
    ["disk", { VERCEL: "1" }],
  ])(
    "on Vercel it is required with the %s driver",
    async (_case, overrides) => {
      stubServerEnv(overrides);
      const failure = import("./server");
      const message = await failure.catch((error: Error) => error.message);
      expect(message).toContain("CRON_SECRET");
    },
  );
});

describe("public env", () => {
  test("valid input parses", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", "Lendshed");
    const { publicEnv } = await import("./public");
    expect(publicEnv.NEXT_PUBLIC_APP_NAME).toBe("Lendshed");
  });

  test("rejects a missing NEXT_PUBLIC_APP_NAME by name", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", undefined);
    await expect(import("./public")).rejects.toThrow("NEXT_PUBLIC_APP_NAME");
  });
});
