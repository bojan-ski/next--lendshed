// For the `auth` CLI only (schema generation); no app code imports this file.
import { betterAuth } from "better-auth";
import { authSchemaOptions } from "./src/lib/auth/schema-options";

export const auth = betterAuth(authSchemaOptions);
