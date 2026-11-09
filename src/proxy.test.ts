import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const ORIGIN = "http://localhost:3000";

describe("proxy", () => {
  test.each(["/", "/nope", "/wordmark.svg"])(
    "adds X-Robots-Tag noindex, nofollow on %s",
    (path) => {
      const response = proxy(new NextRequest(`${ORIGIN}${path}`));
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    },
  );

  test("passes the request through: no redirect, no rewrite", () => {
    const response = proxy(new NextRequest(`${ORIGIN}/login`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy matcher", () => {
  test.each(["/", "/nope", "/wordmark.svg", "/house-rules", "/icon.svg"])(
    "covers %s",
    (path) => {
      expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true);
    },
  );

  test.each([
    "/_next/static/chunks/main.js",
    "/_next/image?url=%2Fwordmark.svg&w=640&q=75",
  ])("excludes the build asset %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(false);
  });
});
