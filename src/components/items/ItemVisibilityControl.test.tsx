import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { hideItem, listItem } from "@/actions/items";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import ItemVisibilityControl from "./ItemVisibilityControl";

vi.mock("@/actions/items", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  listItem: vi.fn(),
  hideItem: vi.fn(),
  retireOwnItem: vi.fn(),
  deleteItem: vi.fn(),
}));

type Props = ComponentProps<typeof ItemVisibilityControl>;

const READY: Props = {
  itemId: "item-1",
  status: "hidden",
  hasPhoto: true,
  ownerHasContactDetails: true,
};

afterEach(() => {
  act(() => dismissToast());
});

const listButton = () => screen.getByRole("button", { name: items.list });
const hideButton = () => screen.getByRole("button", { name: items.hide });

describe("ItemVisibilityControl", () => {
  test("hidden and ready: List item and no needs line", () => {
    render(<ItemVisibilityControl {...READY} />);
    expect(listButton()).toBeEnabled();
    for (const line of [
      items.needsPhoto,
      items.needsContactDetails,
      items.needsBoth,
    ]) {
      expect(screen.queryByText(line)).toBeNull();
    }
  });

  test.each([
    [false, true, items.needsPhoto],
    [true, false, items.needsContactDetails],
    [false, false, items.needsBoth],
  ])(
    "photo %s, contact details %s: the needs line, button still enabled",
    (hasPhoto, ownerHasContactDetails, line) => {
      render(
        <ItemVisibilityControl
          {...READY}
          hasPhoto={hasPhoto}
          ownerHasContactDetails={ownerHasContactDetails}
        />,
      );
      expect(listButton()).toHaveAccessibleDescription(line);
      expect(listButton()).toBeEnabled();
    },
  );

  test("listed: Hide item and no needs line, even with nothing saved", () => {
    render(
      <ItemVisibilityControl
        {...READY}
        status="listed"
        hasPhoto={false}
        ownerHasContactDetails={false}
      />,
    );
    expect(hideButton()).toBeInTheDocument();
    expect(screen.queryByText(items.needsBoth)).toBeNull();
  });

  test("hidden submits listItem with the id; listed submits hideItem", async () => {
    vi.mocked(listItem).mockResolvedValue({ formError: "stale" });
    vi.mocked(hideItem).mockResolvedValue({ formError: "stale" });
    const { rerender } = render(<ItemVisibilityControl {...READY} />);

    await userEvent.click(listButton());
    expect(vi.mocked(listItem).mock.calls[0][1].get("id")).toBe("item-1");
    expect(hideItem).not.toHaveBeenCalled();

    rerender(<ItemVisibilityControl {...READY} status="listed" />);
    await userEvent.click(hideButton());
    expect(hideItem).toHaveBeenCalledTimes(1);
  });

  test("needsPhoto focuses its notice, which is not an alert", async () => {
    vi.mocked(listItem).mockResolvedValue({ formError: "needsPhoto" });
    render(<ItemVisibilityControl {...READY} hasPhoto={false} />);
    await userEvent.click(listButton());

    await screen.findByText(items.needsPhotoRefusal);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(items.needsPhotoRefusal),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("needsContactDetails links to the contact card in Account", async () => {
    vi.mocked(listItem).mockResolvedValue({ formError: "needsContactDetails" });
    render(<ItemVisibilityControl {...READY} />);
    await userEvent.click(listButton());

    const link = await screen.findByRole("link", {
      name: items.needsContactLink,
    });
    expect(link).toHaveAttribute("href", "/account#contact-heading");
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(items.needsContactAfter),
    );
  });

  test.each([
    ["stale", errors.stale],
    ["unexpected", errors.actionFailed],
  ] as const)("%s shows its notice", async (formError, text) => {
    vi.mocked(listItem).mockResolvedValue({ formError });
    render(<ItemVisibilityControl {...READY} />);
    await userEvent.click(listButton());
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  // The page's refresh flips the status; the same button stays focused. A
  // browser drops focus from the disabled pending button; jsdom doesn't, so the
  // action does it here.
  test("a list toasts and keeps focus on the button as it becomes Hide", async () => {
    vi.mocked(listItem).mockImplementation(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      return { flash: "itemListed" };
    });
    const { rerender } = render(<ItemVisibilityControl {...READY} />);
    await userEvent.click(listButton());

    await vi.waitFor(() => expect(getActiveToast()?.key).toBe("itemListed"));
    rerender(<ItemVisibilityControl {...READY} status="listed" />);
    await vi.waitFor(() => expect(hideButton()).toHaveFocus());
  });

  test("a refusal stops showing once the status has flipped", async () => {
    vi.mocked(listItem).mockResolvedValue({ formError: "stale" });
    const { rerender } = render(<ItemVisibilityControl {...READY} />);
    await userEvent.click(listButton());
    await screen.findByText(errors.stale);

    rerender(<ItemVisibilityControl {...READY} status="listed" />);
    expect(screen.queryByText(errors.stale)).toBeNull();
  });
});
