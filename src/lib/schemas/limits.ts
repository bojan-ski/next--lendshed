// The person-field limits (OQ-29) every schema and the auth library share. No
// imports: the auth CLI loads this through schema-options.ts.
export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
