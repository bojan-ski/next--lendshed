import { createElement, type ComponentType, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import {
  forbiddenReached,
  walkImports,
} from "@/__tests__/support/import-graph";
import PublicError from "@/app/(public)/error";
import HouseRulesPage from "@/app/(public)/house-rules/page";
import PublicLayout from "@/app/(public)/layout";
import LoginPage from "@/app/(public)/login/page";
import PrivacyPage from "@/app/(public)/privacy/page";
import RootLayout from "@/app/layout";
import NotFound, { metadata as notFoundMetadata } from "@/app/not-found";
import { errors } from "@/strings/errors";
import { houseRules } from "@/strings/houseRules";
import { login } from "@/strings/login";
import { privacy } from "@/strings/privacy";

// Every way a render could read a session, a cookie, a header or the database
// throws, so a signed-out surface that renders proves it reads none of them.
function forbidden(what: string): never {
  throw new Error(`signed-out surface touched ${what}`);
}

function throwingObject(what: string): object {
  return new Proxy(
    {},
    { get: (_target, key) => forbidden(`${what}.${String(key)}`) },
  );
}

vi.mock("next/headers", () => ({
  cookies: () => forbidden("cookies()"),
  headers: () => forbidden("headers()"),
}));
vi.mock("@/data/viewer", () => ({ getViewer: () => forbidden("getViewer()") }));
vi.mock("@/lib/auth/auth", () => ({ auth: throwingObject("auth") }));
vi.mock("@/db", () => ({ db: throwingObject("db") }));
// next/font needs Next's compiler; the root layout reads only `variable`.
vi.mock("@/app/fonts", () => ({ atkinson: { variable: "font-atkinson" } }));

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

function decode(html: string): string {
  return html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
}

// An error inside a Suspense boundary doesn't reject the prerender (the boundary
// falls back), so errors are collected from onError as well as a rejection.
async function render(tree: ReactNode) {
  const renderErrors: unknown[] = [];
  try {
    const { prelude } = await prerender(tree, {
      onError: (error) => {
        renderErrors.push(error);
      },
    });
    return { html: await new Response(prelude).text(), renderErrors };
  } catch (error) {
    return { html: "", renderErrors: [...renderErrors, error] };
  }
}

function h1Of(html: string): string | undefined {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  return match ? decode(match[1]) : undefined;
}

function inPublicShell(page: ReactNode): ReactNode {
  return createElement(
    RootLayout,
    null,
    createElement(PublicLayout, null, page),
  );
}

const pages: [string, ComponentType<never>, object, string][] = [
  ["/login", LoginPage, { searchParams: Promise.resolve({}) }, login.title],
  ["/house-rules", HouseRulesPage, {}, houseRules.title],
  ["/privacy", PrivacyPage, {}, privacy.title],
];

describe("signed-out surfaces read no session, cookie, header or database", () => {
  test.each(pages)(
    "%s renders in the root and (public) layouts",
    async (_path, Page, props, title) => {
      const { html, renderErrors } = await render(
        inPublicShell(createElement(Page, props as never)),
      );
      expect(renderErrors).toEqual([]);
      expect(html).toContain('<html lang="en"');
      expect(h1Of(html)).toBe(title);
    },
  );

  test("/login resolves its Suspense part: the form, not the skeleton", async () => {
    const { html } = await render(
      inPublicShell(
        createElement(LoginPage, {
          searchParams: Promise.resolve({ next: "/items" }),
        } as never),
      ),
    );
    expect(html).toContain('name="password"');
    expect(html).toContain('name="next" value="/items"');
    expect(decode(html)).toContain(login.emailLabel);
  });

  test("(public)/error.tsx renders its message", async () => {
    const { html, renderErrors } = await render(
      inPublicShell(
        createElement(PublicError, {
          error: new Error("boom"),
          retry: () => {},
        }),
      ),
    );
    expect(renderErrors).toEqual([]);
    expect(decode(html)).toContain(errors.somethingWentWrong);
  });

  test("the root not-found page renders", async () => {
    const { html, renderErrors } = await render(
      createElement(RootLayout, null, createElement(NotFound)),
    );
    expect(renderErrors).toEqual([]);
    expect(h1Of(html)).toBe(errors.notFoundTitle);
    expect(notFoundMetadata.title).toBe(errors.notFoundTitle);
  });

  test("a guarded read inside the tree would fail the render", async () => {
    function ReadsSession(): ReactNode {
      return forbidden("cookies()");
    }
    const { renderErrors } = await render(
      inPublicShell(createElement(ReadsSession)),
    );
    expect(renderErrors).not.toEqual([]);
  });
});

describe("the proxy's import graph", () => {
  test("reaches no database, data-layer or auth-instance module", () => {
    const graph = walkImports(["src/proxy.ts"]);
    expect(
      forbiddenReached(graph, {
        files: (file) =>
          file.startsWith("src/db/") ||
          file.startsWith("src/data/") ||
          file === "src/lib/auth/auth.ts",
        packages: (specifier) => specifier.startsWith("@prisma/"),
      }),
    ).toEqual([]);
    expect(graph.files.has("src/lib/auth/safe-next.ts")).toBe(true);
  });
});
