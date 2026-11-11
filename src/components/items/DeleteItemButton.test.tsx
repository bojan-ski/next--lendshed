import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deleteItem } from "@/actions/items";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import DeleteItemButton from "./DeleteItemButton";

vi.mock("@/actions/items", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  listItem: vi.fn(),
  hideItem: vi.fn(),
  retireOwnItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const TITLE = "Cordless drill";
const DELETE = t(items.deleteFor, { title: TITLE });

const deleteButton = () => screen.getByRole("button", { name: DELETE });
const confirmButton = () =>
  screen.getByRole("button", { name: items.deleteConfirmButton });

async function startConfirm() {
  render(<DeleteItemButton itemId="item-1" title={TITLE} />);
  await userEvent.click(deleteButton());
}

// Success redirects to My items (the action test covers it); here, the steps
// and the refusals.
describe("DeleteItemButton", () => {
  test("names its item, starting with the visible text", () => {
    render(<DeleteItemButton itemId="item-1" title={TITLE} />);
    expect(deleteButton()).toHaveTextContent(items.delete);
    expect(DELETE.startsWith(items.delete)).toBe(true);
  });

  test("Delete asks first, naming the item, and focuses the confirm button", async () => {
    await startConfirm();
    const question = t(items.deleteConfirm, { title: TITLE });
    expect(screen.getByText(question)).toBeInTheDocument();
    await vi.waitFor(() => expect(confirmButton()).toHaveFocus());
    expect(confirmButton()).toHaveAccessibleDescription(question);
    expect(deleteItem).not.toHaveBeenCalled();
  });

  test("Keep goes back without deleting and focuses Delete", async () => {
    await startConfirm();
    await userEvent.click(screen.getByRole("button", { name: items.keep }));
    await vi.waitFor(() => expect(deleteButton()).toHaveFocus());
    expect(deleteItem).not.toHaveBeenCalled();
  });

  test("confirming sends the id", async () => {
    vi.mocked(deleteItem).mockResolvedValue({ formError: "stale" });
    await startConfirm();
    await userEvent.click(confirmButton());
    expect(vi.mocked(deleteItem).mock.calls[0][1].get("id")).toBe("item-1");
  });

  test.each([
    ["hasLoans", items.hasLoansRefusal],
    ["stale", errors.stale],
  ] as const)("%s shows only its focused notice", async (formError, text) => {
    vi.mocked(deleteItem).mockResolvedValue({ formError });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(text);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(text),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("an unexpected failure keeps the confirm step to retry", async () => {
    vi.mocked(deleteItem).mockResolvedValue({ formError: "unexpected" });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(confirmButton()).toBeInTheDocument();
  });
});
