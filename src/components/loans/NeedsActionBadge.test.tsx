import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { countNeedsAction } from "@/data/my-loans";
import { getViewer } from "@/data/viewer";
import { t } from "@/lib/text/interpolate";
import { nav } from "@/strings/nav";
import type { ViewerDTO } from "@/types/viewer";
import NeedsActionBadge from "./NeedsActionBadge";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/data/my-loans", () => ({ countNeedsAction: vi.fn() }));
vi.mock("@/lib/dates/request-today", () => ({
  requestToday: () => "2030-06-15",
}));

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
};

// An async Server Component: resolve it, then render its output.
async function renderBadge() {
  return render(<>{(await NeedsActionBadge()) as ReactNode}</>);
}

describe("NeedsActionBadge", () => {
  test("no viewer → nothing, and no count query", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    const { container } = await renderBadge();
    expect(container).toBeEmptyDOMElement();
    expect(countNeedsAction).not.toHaveBeenCalled();
  });

  test("a count of 0 → nothing", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(countNeedsAction).mockResolvedValue(0);
    const { container } = await renderBadge();
    expect(container).toBeEmptyDOMElement();
  });

  test("counts the viewer on the request's one date, both sides", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(countNeedsAction).mockResolvedValue(2);
    await renderBadge();
    expect(countNeedsAction).toHaveBeenCalledWith("u1", "2030-06-15");
  });

  test.each([
    [1, nav.needsYouOne],
    [2, t(nav.needsYouOther, { count: 2 })],
  ])(
    "%i → the visible number hidden from screen readers, and the sentence for them",
    async (count, sentence) => {
      vi.mocked(getViewer).mockResolvedValue(member);
      vi.mocked(countNeedsAction).mockResolvedValue(count);
      const { container } = await renderBadge();
      const pill = container.querySelector('[aria-hidden="true"]');
      expect(pill).toHaveTextContent(String(count));
      expect(pill).toHaveClass("bg-primary", "rounded-full");
      expect(container.querySelector(".sr-only")).toHaveTextContent(sentence);
      expect(container.textContent).toBe(`${count} ${sentence}`);
    },
  );
});
