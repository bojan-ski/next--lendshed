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

export type JoinOutcome =
  | { kind: "joined"; userId: string }
  | { kind: "invalidToken" }
  | { kind: "emailTaken" };
