import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Invitation and reset links: the raw token lives only in the link, the
// database keeps its hash.

const TOKEN_BYTES = 32;

export function createLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
