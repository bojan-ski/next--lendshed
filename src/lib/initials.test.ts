import { initialsOf } from "./initials";

describe("initialsOf", () => {
  test.each([
    ["Mira K.", "MK"],
    ["Mira", "M"],
    ["mira kovač", "MK"],
    ["Ana Maria Lopez", "AM"],
    ["  Ruth   B.  ", "RB"],
    ["Đorđe J.", "ĐJ"],
  ])("%s → %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
