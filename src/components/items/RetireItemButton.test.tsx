import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { retireOwnItem } from "@/actions/items";
import { ITEM_HEADING_ID } from "@/components/items/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import RetireItemButton from "./RetireItemButton";

vi.mock("@/actions/items", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  listItem: vi.fn(),
  hideItem: vi.fn(),
  retireOwnItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const TITLE = "Cordless drill";
const RETIRE = t(items.retireFor, { title: TITLE });

let turnReadOnly: () => void = () => {};

// Stands in for the edit page: the re-render after a retire drops the cards.
function Page() {
  const [editable, setEditable] = useState(true);
  useEffect(() => {
    turnReadOnly = () => setEditable(false);
  }, []);
  return (
    <>
      <h1 id={ITEM_HEADING_ID} tabIndex={-1}>
        {TITLE}
      </h1>
      {editable && <RetireItemButton itemId="item-1" title={TITLE} />}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const retireButton = () => screen.getByRole("button", { name: RETIRE });
const confirmButton = () =>
  screen.getByRole("button", { name: items.retireConfirmButton });

async function startConfirm() {
  render(<Page />);
  await userEvent.click(retireButton());
}

describe("RetireItemButton", () => {
  test("names its item, starting with the visible text", () => {
    render(<Page />);
    expect(retireButton()).toHaveTextContent(items.retire);
    expect(RETIRE.startsWith(items.retire)).toBe(true);
  });

  test("Retire asks first, naming the item, and focuses the confirm button", async () => {
    await startConfirm();
    const question = t(items.retireConfirm, { title: TITLE });
    expect(screen.getByText(question)).toBeInTheDocument();
    await vi.waitFor(() => expect(confirmButton()).toHaveFocus());
    expect(confirmButton()).toHaveAccessibleDescription(question);
    expect(retireOwnItem).not.toHaveBeenCalled();
  });

  test("Keep goes back without retiring and focuses Retire", async () => {
    await startConfirm();
    await userEvent.click(screen.getByRole("button", { name: items.keep }));
    await vi.waitFor(() => expect(retireButton()).toHaveFocus());
    expect(retireOwnItem).not.toHaveBeenCalled();
  });

  test("confirming sends the id", async () => {
    vi.mocked(retireOwnItem).mockResolvedValue({ formError: "stale" });
    await startConfirm();
    await userEvent.click(confirmButton());
    expect(vi.mocked(retireOwnItem).mock.calls[0][1].get("id")).toBe("item-1");
  });

  // The button unmounts in the same commit as the action's state.
  test("a retire toasts and focuses the title even as the button unmounts", async () => {
    vi.mocked(retireOwnItem).mockImplementation(async () => {
      turnReadOnly();
      return { flash: "itemRetired" };
    });
    await startConfirm();

    await userEvent.click(confirmButton());

    await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(getActiveToast()?.key).toBe("itemRetired");
    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { name: TITLE })).toHaveFocus(),
    );
  });

  test.each([
    ["blocked", items.blockedRefusal],
    ["stale", errors.stale],
  ] as const)("%s shows only its focused notice", async (formError, text) => {
    vi.mocked(retireOwnItem).mockResolvedValue({ formError });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(text);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(text),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getActiveToast()).toBeNull();
  });

  test("an unexpected failure keeps the confirm step to retry", async () => {
    vi.mocked(retireOwnItem).mockResolvedValue({ formError: "unexpected" });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(confirmButton()).toBeInTheDocument();
  });
});
