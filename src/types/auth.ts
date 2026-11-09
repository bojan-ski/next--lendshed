export type SignInFormError =
  "invalidCredentials" | "suspended" | "tooManyAttempts" | "unexpected";

export type SignInState = {
  fieldErrors?: Partial<Record<"email" | "password", string[]>>;
  formError?: SignInFormError;
  email?: string;
};
