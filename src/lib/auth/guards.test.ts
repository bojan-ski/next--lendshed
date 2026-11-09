import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getViewer } from "@/data/viewer";
import type { ViewerDTO } from "@/types/viewer";
import { requireOrganizer, requireViewer } from "./guards";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
  needsActionCount: 0,
};
const organizer: ViewerDTO = { ...member, role: "organizer" };

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

function digestOf(error: unknown): string {
  return (error as { digest?: string }).digest ?? "";
}

describe("requireViewer", () => {
  test("redirects to /login with no viewer", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    const error = await thrownBy(requireViewer());
    expect(isRedirectError(error)).toBe(true);
    expect(digestOf(error)).toContain(";/login;");
  });

  test("returns the viewer", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    await expect(requireViewer()).resolves.toEqual(member);
  });
});

describe("requireOrganizer", () => {
  test("redirects to /login with no viewer", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expect(isRedirectError(await thrownBy(requireOrganizer()))).toBe(true);
  });

  test("calls not-found for a member", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    const error = await thrownBy(requireOrganizer());
    expect(isRedirectError(error)).toBe(false);
    expect(digestOf(error)).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  test("returns an organizer", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    await expect(requireOrganizer()).resolves.toEqual(organizer);
  });
});
