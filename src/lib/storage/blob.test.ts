import { BlobNotFoundError, del, put } from "@vercel/blob";
import { createBlobStorage } from "./blob";

vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  put: vi.fn(),
  del: vi.fn(),
}));

const publicHost = "abc123.public.blob.vercel-storage.com";
const storage = createBlobStorage({ token: "rw-token", publicHost });
const bytes = new Uint8Array([1, 2, 3]);

const putResult = (url: string) => ({ url }) as Awaited<ReturnType<typeof put>>;

describe("createBlobStorage", () => {
  test("put stores the key as given: public, no suffix, no overwrite", async () => {
    vi.mocked(put).mockResolvedValue(
      putResult(`https://${publicHost}/items/a.webp`),
    );

    expect(await storage.put("items/a.webp", bytes, "image/webp")).toEqual({
      url: `https://${publicHost}/items/a.webp`,
    });
    const [pathname, body, options] = vi.mocked(put).mock.calls[0];
    expect(pathname).toBe("items/a.webp");
    expect(new Uint8Array(body as Buffer)).toEqual(bytes);
    expect(options).toEqual({
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "image/webp",
      token: "rw-token",
    });
  });

  test("put refuses a URL on any other host", async () => {
    vi.mocked(put).mockResolvedValue(
      putResult(
        "https://elsewhere.public.blob.vercel-storage.com/items/a.webp",
      ),
    );

    await expect(
      storage.put("items/a.webp", bytes, "image/webp"),
    ).rejects.toThrow("configured public host");
  });

  test("delete passes the key as the pathname, with the token", async () => {
    vi.mocked(del).mockResolvedValue(undefined);
    await storage.delete("items/a.webp");
    expect(del).toHaveBeenCalledWith("items/a.webp", { token: "rw-token" });
  });

  test("delete of a missing blob resolves; other failures throw", async () => {
    vi.mocked(del).mockRejectedValueOnce(new BlobNotFoundError());
    await expect(storage.delete("items/gone.webp")).resolves.toBeUndefined();

    vi.mocked(del).mockRejectedValueOnce(new Error("network down"));
    await expect(storage.delete("items/a.webp")).rejects.toThrow(
      "network down",
    );
  });
});
