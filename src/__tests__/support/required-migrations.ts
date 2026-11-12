// The migrations every database test and the e2e setup need applied. No
// imports: Vitest (through test-db.ts) and the Playwright setup both read it.
export const REQUIRED_MIGRATIONS = [
  "auth",
  "invitations",
  "password_reset_grants",
  "categories",
  "items_and_loans",
  "loan_no_overlap",
  "uploads",
] as const;
