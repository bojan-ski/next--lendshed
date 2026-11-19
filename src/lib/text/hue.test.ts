import { categoryHues, hueFor, HUES } from "./hue";

describe("categoryHues", () => {
  test("the first five categories, in list order, get five different hues", () => {
    const list = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const hues = categoryHues(list);
    expect(list.map(({ id }) => hues.get(id))).toEqual([...HUES]);
  });

  test("the sixth wraps round to the first hue; an unknown id has none", () => {
    const hues = categoryHues(
      ["a", "b", "c", "d", "e", "f"].map((id) => ({ id })),
    );
    expect(hues.get("f")).toBe(HUES[0]);
    expect(hues.get("zzz")).toBeUndefined();
  });
});

describe("hueFor", () => {
  test("is stable for an id and always one of the hues", () => {
    expect(hueFor("user-1")).toBe(hueFor("user-1"));
    expect(HUES).toContain(hueFor("user-1"));
  });
});
