import { expect, test, type APIResponse } from "@playwright/test";

// Request-level checks only: no page, no clicks, no database, no rows.

const NOINDEX = "noindex, nofollow";

function metaContents(html: string, name: string): string[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => new RegExp(`\\bname=["']${name}["']`, "i").test(tag))
    .map((tag) => /\bcontent=["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
}

function expectNoindexHeader(response: APIResponse) {
  expect(response.headers()["x-robots-tag"]).toBe(NOINDEX);
}

test("/robots.txt disallows every crawler and carries the header", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expectNoindexHeader(response);

  const lines = (await response.text())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  expect(lines.some((line) => /^user-agent:\s*\*$/i.test(line))).toBe(true);
  expect(lines).toContain("Disallow: /");
  expect(lines.filter((line) => /^(allow|sitemap|host):/i.test(line))).toEqual(
    [],
  );
});

test("/sitemap.xml is a 404", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(404);
  expectNoindexHeader(response);
});

test("/login renders the robots meta element and carries the header", async ({
  request,
}) => {
  const response = await request.get("/login");
  expect(response.status()).toBe(200);
  expectNoindexHeader(response);
  expect(metaContents(await response.text(), "robots")).toEqual([NOINDEX]);
});

test("/invite/{token} renders robots and referrer meta and sends Referrer-Policy", async ({
  request,
}) => {
  const response = await request.get(`/invite/${"A".repeat(43)}`);
  expect(response.status()).toBe(200);
  expectNoindexHeader(response);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");

  const html = await response.text();
  expect(metaContents(html, "robots")).toEqual([NOINDEX]);
  expect(metaContents(html, "referrer")).toEqual(["no-referrer"]);
});
