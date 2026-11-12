import { reportUnexpected } from "./report";

const logged = () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => spy.mock.calls;
};

test("logs the action, name, code, first message line and stack frames", () => {
  const calls = logged();
  const error = Object.assign(
    new Error(
      'Invalid `prisma.invitation.create()` invocation\n{ data: { tokenHash: "abc" } }',
    ),
    { code: "P2002" },
  );

  reportUnexpected("createInvitation", error);

  const [[label, detail]] = calls();
  expect(label).toBe("createInvitation: unexpected");
  expect(detail).toMatchObject({
    name: "Error",
    code: "P2002",
    message: "Invalid `prisma.invitation.create()` invocation",
  });
  expect(detail.frames.length).toBeGreaterThan(0);
  expect(JSON.stringify(detail)).not.toContain("tokenHash");
});

// A V8 stack starts with the whole message, so a continuation line shaped like
// a frame must not pass for one.
test("a message line that looks like a frame stays out of the frames", () => {
  const calls = logged();
  const error = new Error(
    "Invalid call\n  at pickupNotes: Side door, code 1234",
  );

  reportUnexpected("updateItem", error);

  const [[, detail]] = calls();
  expect(JSON.stringify(detail)).not.toContain("Side door");
  expect(detail.frames.length).toBeGreaterThan(0);
});

test("the first message line is capped", () => {
  const calls = logged();

  reportUnexpected("deleteItem", new Error("x".repeat(500)));

  expect(calls()[0][1].message).toHaveLength(200);
});

test("a non-Error value is logged by its type alone", () => {
  const calls = logged();

  reportUnexpected("deleteItem", "storage down: token=secret");

  expect(calls()).toEqual([["deleteItem: unexpected", { name: "string" }]]);
});
