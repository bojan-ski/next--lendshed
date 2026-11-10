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

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

const withSession = { cookie: "better-auth.session_token=anything.sig" };

describe("proxy guard", () => {
  test.each([
    ["/", "/login?next=%2F"],
    ["/items/x?y=1", "/login?next=%2Fitems%2Fx%3Fy%3D1"],
    ["/admin/members", "/login?next=%2Fadmin%2Fmembers"],
  ])("a cookie-less %s gets a 307 to %s", (path, location) => {
    const response = proxy(request(path));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${location}`);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  test("validates next: a protocol-relative path becomes /", () => {
    const response = proxy(request("//evil"));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2F`);
  });

  test.each([
    "/login",
    "/invite/abc",
    "/reset/abc",
    "/house-rules",
    "/privacy",
    "/api/auth/sign-in/email",
    "/api/cron/daily",
    "/favicon.ico",
    "/wordmark.svg",
    "/robots.txt",
    "/items/photo.webp",
  ])("lets a cookie-less %s through", (path) => {
    const response = proxy(request(path));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  test.each([
    ["better-auth.session_token"],
    ["__Secure-better-auth.session_token"],
  ])("lets a request with a %s cookie through, valid or not", (name) => {
    for (const path of ["/", "/admin", "/items/x"]) {
      const response = proxy(request(path, { cookie: `${name}=stale.sig` }));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });

  test("never redirects /login, with or without a cookie", () => {
    for (const headers of [{}, withSession]) {
      expect(proxy(request("/login?next=%2F", headers)).status).not.toBe(307);
    }
  });

  test("sets x-lendshed-path to pathname + search, overwriting the client's", () => {
    const response = proxy(
      request("/items/x?y=1", {
        ...withSession,
        "x-lendshed-path": "//evil.com",
      }),
    );
    expect(response.headers.get("x-middleware-request-x-lendshed-path")).toBe(
      "/items/x?y=1",
    );
  });
});

describe("proxy Referrer-Policy", () => {
  // A POST is how a Server Action on the page reaches the server.
  test.each(["GET", "POST"])(
    "%s /invite/{token} sends no-referrer alongside X-Robots-Tag",
    (method) => {
      const response = proxy(
        new NextRequest(`${ORIGIN}/invite/${"A".repeat(43)}`, { method }),
      );
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    },
  );

  test.each(["/login", "/", "/invite"])(
    "%s gets no Referrer-Policy",
    (path) => {
      expect(proxy(request(path)).headers.get("Referrer-Policy")).toBeNull();
    },
  );

  test("the matcher covers /invite/{token}", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/invite/abc" })).toBe(
      true,
    );
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
