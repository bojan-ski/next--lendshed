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

// Exactly CLAUDE.md's island list: a new 'use client' file fails here until it
// is named, both here and in the Project Decisions.
const ISLANDS = [
  "src/app/(app)/error.tsx",
  "src/app/(public)/error.tsx",
  "src/app/global-error.tsx",
  "src/components/account/ChangePasswordForm.tsx",
  "src/components/account/ContactDetailsForm.tsx",
  "src/components/account/ProfileForm.tsx",
  "src/components/auth/JoinForm.tsx",
  "src/components/auth/LoginForm.tsx",
  "src/components/auth/ResetPasswordForm.tsx",
  "src/components/feedback/Toaster.tsx",
  "src/components/invitations/NewInvitationForm.tsx",
  "src/components/invitations/RevokeInvitationButton.tsx",
  "src/components/members/ResetLinkForm.tsx",
  "src/components/members/RoleChangeButton.tsx",
  "src/components/shell/NavLink.tsx",
  "src/components/ui/Button.tsx",
  "src/components/ui/PasswordInput.tsx",
];

describe("client boundary", () => {
  test(`finds exactly the ${ISLANDS.length} 'use client' files`, () => {
    expect([...clientFiles].sort()).toEqual(ISLANDS);
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
