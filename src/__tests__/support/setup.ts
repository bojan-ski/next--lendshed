import "@testing-library/jest-dom/vitest";
import { loadEnvConfig } from "@next/env";

// Next inlines NEXT_PUBLIC_ vars into client code at build time; islands read
// them from the same env files here.
loadEnvConfig(process.cwd());
