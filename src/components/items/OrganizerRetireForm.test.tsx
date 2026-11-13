import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { retireItemAsOrganizer } from "@/actions/items";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { RETIRED_NOTE_MAX } from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { itemPage } from "@/strings/itemPage";
import { items } from "@/strings/items";
import type { OrganizerRetireState } from "@/types/item";
import OrganizerRetireForm from "./OrganizerRetireForm";

vi.mock("@/actions/items", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  listItem: vi.fn(),
  hideItem: vi.fn(),
  retireOwnItem: vi.fn(),
  deleteItem: vi.fn(),
  retireItemAsOrganizer: vi.fn(),
}));

const TITLE = "Cordless drill";
const RETIRE = t(items.retireFor, { title: TITLE });
const QUESTION = t(itemPage.retireQuestion, { title: TITLE });

afterEach(() => {
  act(() => dismissToast());
});

const retireButton = () => screen.getByRole("button", { name: RETIRE });
const confirmButton = () =>
  screen.getByRole("button", { name: items.retireConfirmButton });
const noteInput = () =>
  screen.getByRole("textbox", { name: itemPage.retireNoteLabel });

async function startConfirm() {
  render(<OrganizerRetireForm itemId="item-1" title={TITLE} />);
  await userEvent.click(retireButton());
}

// A browser drops focus when the pending button is disabled; jsdom doesn't.
function refuseWith(state: OrganizerRetireState) {
  vi.mocked(retireItemAsOrganizer).mockImplementation(async () => {
    (document.activeElement as HTMLElement).blur();
    return state;
  });
}

describe("OrganizerRetireForm", () => {
  test("names its item, starting with the visible text", () => {
    render(<OrganizerRetireForm itemId="item-1" title={TITLE} />);
    expect(retireButton()).toHaveTextContent(items.retire);
    expect(RETIRE.startsWith(items.retire)).toBe(true);
  });

  test("Retire opens the step naming the item and focuses the note", async () => {
    await startConfirm();

    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    await vi.waitFor(() => expect(noteInput()).toHaveFocus());
    expect(confirmButton()).toHaveAccessibleDescription(QUESTION);
    expect(noteInput()).toHaveAttribute("maxLength", String(RETIRED_NOTE_MAX));
    expect(noteInput()).toHaveAccessibleDescription(itemPage.retireNoteHint);
    expect(retireItemAsOrganizer).not.toHaveBeenCalled();
  });

  test("Keep it goes back without retiring and focuses Retire", async () => {
    await startConfirm();
    await userEvent.click(screen.getByRole("button", { name: itemPage.keep }));

    await vi.waitFor(() => expect(retireButton()).toHaveFocus());
    expect(retireItemAsOrganizer).not.toHaveBeenCalled();
  });

  test("confirming sends the id and the note", async () => {
    vi.mocked(retireItemAsOrganizer).mockResolvedValue({ formError: "stale" });
    await startConfirm();
    await userEvent.type(noteInput(), "Unsafe blade");
    await userEvent.click(confirmButton());

    const sent = vi.mocked(retireItemAsOrganizer).mock.calls[0][1];
    expect(sent.get("id")).toBe("item-1");
    expect(sent.get("note")).toBe("Unsafe blade");
  });

  test("a note error focuses the note with the error and the echoed text", async () => {
    refuseWith({
      fieldErrors: { note: [itemPage.retireNoteRequired] },
      values: { note: "  " },
    });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(itemPage.retireNoteRequired);
    await vi.waitFor(() => expect(noteInput()).toHaveFocus());
    expect(noteInput()).toHaveAttribute("aria-invalid", "true");
    expect(noteInput()).toHaveValue("  ");
    expect(confirmButton()).toBeInTheDocument();
  });

  test.each([
    ["stale", errors.stale],
    ["stillOut", itemPage.retireStillOut],
  ] as const)("%s shows only its focused notice", async (formError, text) => {
    refuseWith({ formError });
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

  test("an unexpected failure keeps the step with the note to retry", async () => {
    refuseWith({ formError: "unexpected", values: { note: "Unsafe blade" } });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();
    expect(noteInput()).toHaveValue("Unsafe blade");
  });
});
