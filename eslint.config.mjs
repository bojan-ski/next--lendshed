import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**", "src/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/credentials", "**/db/credentials"],
              message:
                "Creates users with any role and isn't server-only: call it from a Server Action or script.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generated client (gitignored, written by `prisma generate`)
    "src/generated/**",
    // The design handoff's HTML-mock runtime: reference, not app code.
    "context/redesign/**",
  ]),
]);

export default eslintConfig;
