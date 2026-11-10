import { createHash } from "node:crypto";
import { createLinkToken, hashLinkToken } from "./link-tokens";

describe("link tokens", () => {
  test("a token is 43 base64url characters (32 random bytes)", () => {
    const { token } = createLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  test("tokens don't repeat", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => createLinkToken().token),
    );
    expect(tokens.size).toBe(50);
  });

  test("the hash is SHA-256 of the token, lowercase hex", () => {
    const { token, tokenHash } = createLinkToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashLinkToken(token)).toBe(tokenHash);
  });

  test("hashing is deterministic and never returns the token", () => {
    const token = "A".repeat(43);
    expect(hashLinkToken(token)).toBe(hashLinkToken(token));
    expect(hashLinkToken(token)).not.toContain(token);
  });
});
