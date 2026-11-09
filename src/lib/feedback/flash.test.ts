import { cookies } from "next/headers";
import type { FlashKey } from "@/strings";
import { setFlash } from "./flash";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const set = vi.fn();

beforeEach(() => {
  vi.mocked(cookies).mockResolvedValue({ set } as unknown as Awaited<
    ReturnType<typeof cookies>
  >);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const key = "itemSaved" as FlashKey;

describe("setFlash", () => {
  test("sets exactly the flash cookie from the spec table", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await setFlash(key);
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith("flash", "itemSaved", {
      maxAge: 60,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: false,
    });
  });

  test("is Secure in production only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setFlash(key);
    expect(set).toHaveBeenCalledWith(
      "flash",
      "itemSaved",
      expect.objectContaining({ secure: true }),
    );
  });

  test("its parameter type rejects a string that is not a FlashKey", () => {
    // @ts-expect-error "free text" is not a key of strings.flash
    const call = () => setFlash("free text");
    expect(call).toBeTypeOf("function");
  });
});
