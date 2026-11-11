import { people } from "@/strings/people";
import { personName, toPhotoDTO } from "./mappers";

describe("toPhotoDTO", () => {
  test("maps a complete photo to url, width and height only", () => {
    expect(
      toPhotoDTO({
        photoUrl: "https://x/p.webp",
        photoWidth: 1200,
        photoHeight: 900,
      }),
    ).toEqual({ url: "https://x/p.webp", width: 1200, height: 900 });
  });

  test.each([
    [{ photoUrl: null, photoWidth: 1200, photoHeight: 900 }],
    [{ photoUrl: "https://x/p.webp", photoWidth: null, photoHeight: 900 }],
    [{ photoUrl: "https://x/p.webp", photoWidth: 1200, photoHeight: null }],
    [{ photoUrl: null, photoWidth: null, photoHeight: null }],
  ])("is null unless all three are set (%j)", (row) => {
    expect(toPhotoDTO(row)).toBeNull();
  });
});

describe("personName", () => {
  test("is the display name", () => {
    expect(personName({ name: "Ana P." })).toBe("Ana P.");
  });

  test("is Former member for a deleted account (OQ-18)", () => {
    expect(personName(null)).toBe(people.formerMember);
  });
});
