import { Prisma } from "@/generated/prisma/client";
import { failureLine, hostOf } from "./cli";

const URL_VALUE =
  "postgresql://neon_user:hunter2-secret@ep-host-123.eu-central-1.aws.neon.tech/app?sslmode=require";
const SECRETS = [
  "neon_user",
  "hunter2-secret",
  "postgresql://",
  "/app",
  "sslmode",
];

describe("hostOf", () => {
  test("returns the host only", () => {
    expect(hostOf(URL_VALUE)).toBe("ep-host-123.eu-central-1.aws.neon.tech");
    for (const secret of SECRETS)
      expect(hostOf(URL_VALUE)).not.toContain(secret);
  });

  test("an unparsable URL gives a placeholder, never the input", () => {
    expect(hostOf("hunter2-secret not a url")).toBe("(unknown host)");
  });
});

describe("failureLine", () => {
  test("a known Prisma error gives its class and code, never its message", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed while connected to ${URL_VALUE}`,
      { code: "P2002", clientVersion: "7.10.1" },
    );
    const line = failureLine(error);
    expect(line).toBe("Failed: PrismaClientKnownRequestError (P2002)");
    for (const secret of SECRETS) expect(line).not.toContain(secret);
  });

  test("an initialization error gives its error code", () => {
    const error = new Prisma.PrismaClientInitializationError(
      `Can't reach ${URL_VALUE}`,
      "7.10.1",
      "P1001",
    );
    expect(failureLine(error)).toBe(
      "Failed: PrismaClientInitializationError (P1001)",
    );
  });

  test("any other error gives its class only", () => {
    const line = failureLine(new TypeError(`bad ${URL_VALUE}`));
    expect(line).toBe("Failed: TypeError");
  });

  test("a thrown non-error gives its type only", () => {
    expect(failureLine(URL_VALUE)).toBe("Failed: string");
  });
});
