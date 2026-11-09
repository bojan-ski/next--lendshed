import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  // `server-only` throws outside the react-server condition — every server test
  // imports an action/data/env module that imports it
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    globals: true, // the kit's tests use bare test/expect/vi
    css: { include: [/src\/.*\.css/] }, // testing-patterns: raw @theme source reaches tests
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          setupFiles: ["src/__tests__/support/server-env.ts"], // loads .env.test (below)
          include: [
            "src/{actions,data,lib,db}/**/*.test.ts",
            "src/app/**/*.test.ts",
            "src/proxy.test.ts",
            "src/__tests__/consolidation/**/*.test.ts",
            "scripts/**/*.test.ts",
            "prisma/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "islands",
          environment: "jsdom",
          setupFiles: ["src/__tests__/support/setup.ts"], // imports '@testing-library/jest-dom/vitest'
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});
