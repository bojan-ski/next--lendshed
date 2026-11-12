import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { countNeedsAction, getMyLoans } from "@/data/my-loans";
import { requireViewer } from "@/lib/auth/guards";
import { formatDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { loanCard } from "@/strings/loanCard";
import { myLoans } from "@/strings/myLoans";
import type { LoanCardDTO, MyLoansDTO } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";
import MyLoansSection from "./MyLoansSection";

vi.mock("@/lib/auth/guards", () => ({ requireViewer: vi.fn() }));
vi.mock("@/data/my-loans", () => ({
  getMyLoans: vi.fn(),
  countNeedsAction: vi.fn(),
}));
vi.mock("@/lib/dates/request-today", () => ({
  requestToday: () => "2030-06-15",
}));

const TODAY = "2030-06-15";

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
};

const card = (
  id: string,
  overrides: Partial<LoanCardDTO> = {},
): LoanCardDTO => ({
  id,
  side: "borrowing",
  item: { id: `item-${id}`, title: `Item ${id}`, photo: null },
  otherPartyName: "Ruth K.",
  startDate: "2030-06-14",
  endDate: "2030-06-16",
  status: "out",
  group: "active",
  needsYou: null,
  changed: false,
  ...overrides,
});

const EMPTY: MyLoansDTO = { needs_you: [], active: [], past: [] };

async function renderSection(searchParams: Record<string, string> = {}) {
  vi.mocked(requireViewer).mockResolvedValue(member);
  const tree = await MyLoansSection({
    searchParams: Promise.resolve(searchParams),
  });
  return render(tree as ReactNode);
}

const tabsNav = () =>
  screen.getByRole("navigation", { name: myLoans.tabsLabel });

describe("MyLoansSection", () => {
  test("?tab=lending reads Lending and marks only that tab current", async () => {
    vi.mocked(getMyLoans).mockResolvedValue(EMPTY);
    await renderSection({ tab: "lending" });

    expect(getMyLoans).toHaveBeenCalledWith("u1", "lending", TODAY);
    expect(countNeedsAction).not.toHaveBeenCalled();
    const lending = within(tabsNav()).getByRole("link", {
      name: myLoans.tabs.lending,
    });
    const borrowing = within(tabsNav()).getByRole("link", {
      name: myLoans.tabs.borrowing,
    });
    expect(lending).toHaveAttribute("aria-current", "page");
    expect(lending).toHaveAttribute("href", "/my/loans?tab=lending");
    expect(borrowing).not.toHaveAttribute("aria-current");
    expect(borrowing).toHaveAttribute("href", "/my/loans?tab=borrowing");
  });

  test.each<[string, Record<string, string>]>([
    ["missing", {}],
    ["empty", { tab: "" }],
    ["unknown", { tab: "both" }],
  ])(
    "a %s tab falls back to the default, never an error",
    async (_label, params) => {
      vi.mocked(getMyLoans).mockResolvedValue(EMPTY);
      vi.mocked(countNeedsAction).mockResolvedValue(0);
      await renderSection(params);

      expect(countNeedsAction).toHaveBeenCalledWith("u1", TODAY, "borrowing");
      expect(countNeedsAction).toHaveBeenCalledWith("u1", TODAY, "lending");
      expect(getMyLoans).toHaveBeenCalledWith("u1", "borrowing", TODAY);
      expect(
        within(tabsNav()).getByRole("link", { name: myLoans.tabs.borrowing }),
      ).toHaveAttribute("aria-current", "page");
    },
  );

  test("groups appear in order as h2s over h3 cards; an empty group is omitted", async () => {
    vi.mocked(getMyLoans).mockResolvedValue({
      needs_you: [
        card("a", { group: "needs_you", needsYou: "due_back", endDate: TODAY }),
      ],
      active: [],
      past: [card("c", { group: "past", status: "returned" })],
    });
    await renderSection({ tab: "borrowing" });

    const groups = screen.getAllByRole("heading", { level: 2 });
    expect(groups.map((heading) => heading.textContent)).toEqual([
      myLoans.groups.needs_you,
      myLoans.groups.past,
    ]);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Item a", "Item c"]);
  });

  test("the next-step line shows only on needs-you cards, with the other party", async () => {
    vi.mocked(getMyLoans).mockResolvedValue({
      ...EMPTY,
      needs_you: [
        card("a", { group: "needs_you", needsYou: "arrange_pickup" }),
      ],
      active: [card("b")],
    });
    await renderSection({ tab: "borrowing" });

    const pickup = t(loanCard.nextStep.arrange_pickup, { name: "Ruth K." });
    expect(screen.getByText(pickup)).toBeInTheDocument();
    // The active card has its party line and nothing more.
    const active = screen
      .getByRole("heading", { level: 3, name: "Item b" })
      .closest("li")!;
    expect(active.querySelectorAll("p")).toHaveLength(1);
  });

  test.each([["lending"], ["borrowing"]] as const)(
    "overdue on %s is worded for that side, with the end date",
    async (side) => {
      vi.mocked(getMyLoans).mockResolvedValue({
        ...EMPTY,
        needs_you: [
          card("a", {
            side,
            status: "overdue",
            group: "needs_you",
            needsYou: "overdue",
            startDate: "2030-06-10",
            endDate: "2030-06-12",
          }),
        ],
      });
      await renderSection({ tab: side });

      expect(
        screen.getByText(
          t(loanCard.overdue[side], {
            name: "Ruth K.",
            date: formatDate("2030-06-12", TODAY),
          }),
        ),
      ).toBeInTheDocument();
    },
  );

  test.each([
    ["borrowing", "/"],
    ["lending", "/my/items"],
  ] as const)(
    "an empty %s tab shows its empty state with one link",
    async (tab, href) => {
      vi.mocked(getMyLoans).mockResolvedValue(EMPTY);
      await renderSection({ tab });

      expect(
        screen.getByRole("heading", {
          level: 2,
          name: myLoans.empty[tab].heading,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(myLoans.empty[tab].body)).toBeInTheDocument();
      const action = screen.getByRole("link", {
        name: myLoans.empty[tab].action,
      });
      expect(action).toHaveAttribute("href", href);
      expect(screen.getAllByRole("link")).toHaveLength(3);
    },
  );

  test("a guest is turned away by the section's own guard", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    vi.mocked(requireViewer).mockRejectedValue(redirect);
    await expect(
      MyLoansSection({ searchParams: Promise.resolve({}) }),
    ).rejects.toBe(redirect);
    expect(getMyLoans).not.toHaveBeenCalled();
  });
});
