export type SignInFormError =
  "invalidCredentials" | "suspended" | "tooManyAttempts" | "unexpected";

export type SignInState = {
  fieldErrors?: Partial<Record<"email" | "password", string[]>>;
  formError?: SignInFormError;
  email?: string;
};

export type JoinState = {
  fieldErrors?: Partial<
    Record<"name" | "email" | "password" | "acceptHouseRules", string[]>
  >;
  formError?: "unexpected";
  linkBroken?: true;
  name?: string;
  email?: string;
};

export type ResetPasswordState = {
  fieldErrors?: Partial<Record<"password", string[]>>;
  formError?: "unexpected";
  linkBroken?: true;
};

export type ResetOutcome =
  { kind: "reset"; userId: string } | { kind: "invalidToken" };

export type JoinOutcome =
  | { kind: "joined"; userId: string }
  | { kind: "invalidToken" }
  | { kind: "emailTaken" };
