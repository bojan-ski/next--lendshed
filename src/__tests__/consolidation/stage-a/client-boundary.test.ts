import {
  forbiddenReached,
  isUseClientModule,
  parseFile,
  sourceFiles,
  walkImports,
  type ForbiddenRule,
} from "@/__tests__/support/import-graph";

const SERVER_ONLY_FILES = [
  "src/lib/auth/auth.ts",
  "src/lib/env/server.ts",
  "src/lib/feedback/flash.ts",
];

const serverCode: ForbiddenRule = {
  files: (file) =>
    file.startsWith("src/db/") ||
    file.startsWith("src/data/") ||
    SERVER_ONLY_FILES.includes(file),
  packages: (specifier) =>
    specifier === "server-only" ||
    specifier.startsWith("@prisma/") ||
    specifier === "better-auth/crypto",
};

const clientFiles = sourceFiles("src/**/*.{ts,tsx}").filter(
  (file) => !/\.test\.tsx?$/.test(file) && isUseClientModule(parseFile(file)),
);

describe("client boundary", () => {
  test("finds the 'use client' files", () => {
    expect(clientFiles).toEqual(
      expect.arrayContaining([
        "src/components/feedback/Toaster.tsx",
        "src/components/auth/LoginForm.tsx",
        "src/components/auth/JoinForm.tsx",
        "src/components/invitations/NewInvitationForm.tsx",
        "src/components/invitations/RevokeInvitationButton.tsx",
        "src/components/account/ProfileForm.tsx",
        "src/components/account/ContactDetailsForm.tsx",
        "src/components/account/ChangePasswordForm.tsx",
        "src/components/members/RoleChangeButton.tsx",
        "src/components/members/ResetLinkForm.tsx",
        "src/components/auth/ResetPasswordForm.tsx",
      ]),
    );
  });

  test.each(clientFiles)("%s reaches no server-only code", (file) => {
    expect(forbiddenReached(walkImports([file]), serverCode)).toEqual([]);
  });
});

describe("the walk", () => {
  const sources = {
    "virtual/island.tsx": [
      `"use client";`,
      `import type { ViewerDTO } from "@/types/viewer";`,
      `import { type ItemCardDTO } from "@/types/item";`,
      `import { act } from "./action";`,
      `import { helper } from "./helper";`,
    ].join("\n"),
    "virtual/action.ts": `"use server";\nimport { db } from "@/db";\nexport const act = () => db;`,
    "virtual/helper.ts": `export { credentials } from "@/db/credentials";\nexport const helper = () => import("server-only");`,
  };
  const graph = walkImports(["virtual/island.tsx"], { sources });

  test("follows relative and @/ imports, re-exports and import()", () => {
    expect(graph.files.has("src/db/credentials.ts")).toBe(true);
    expect(graph.packages.has("server-only")).toBe(true);
  });

  test("stops at a 'use server' module and skips type-only imports", () => {
    expect(graph.files.has("virtual/action.ts")).toBe(true);
    expect(graph.files.has("src/db/index.ts")).toBe(false);
    expect(graph.files.has("src/types/viewer.ts")).toBe(false);
    expect(graph.files.has("src/types/item.ts")).toBe(false);
  });

  test("reports the chain to each forbidden module", () => {
    expect(forbiddenReached(graph, serverCode)).toEqual(
      expect.arrayContaining([
        "virtual/island.tsx → virtual/helper.ts → src/db/credentials.ts",
        "virtual/island.tsx → virtual/helper.ts → server-only",
      ]),
    );
  });
});
