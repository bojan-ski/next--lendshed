import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { deleteCategory } from "@/actions/categories";
import { CATEGORIES_HEADING_ID } from "@/components/categories/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { categories } from "@/strings/categories";
import { errors } from "@/strings/errors";
import DeleteCategoryButton from "./DeleteCategoryButton";

vi.mock("@/actions/categories", () => ({
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

const CATEGORY = { id: "cat-1", name: "Garden" };
const DELETE = t(categories.deleteFor, { name: CATEGORY.name });

let removeRow: () => void = () => {};

// Stands in for the page: the re-render after a delete drops the row.
function Page() {
  const [showRow, setShowRow] = useState(true);
  useEffect(() => {
    removeRow = () => setShowRow(false);
  }, []);
  return (
    <>
      <h2 id={CATEGORIES_HEADING_ID} tabIndex={-1}>
        {categories.listHeading}
      </h2>
      {showRow && <DeleteCategoryButton category={CATEGORY} />}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const deleteButton = () => screen.getByRole("button", { name: DELETE });
const confirmButton = () =>
  screen.getByRole("button", { name: categories.deleteConfirmButton });

async function startConfirm() {
  render(<Page />);
  await userEvent.click(deleteButton());
}

describe("DeleteCategoryButton", () => {
  test("names its category, starting with the visible text", () => {
    render(<Page />);
    expect(deleteButton()).toHaveTextContent(categories.delete);
    expect(DELETE.startsWith(categories.delete)).toBe(true);
  });

  test("Delete asks first, naming the category, and focuses the confirm button", async () => {
    await startConfirm();
    expect(
      screen.getByText(t(categories.deleteConfirm, { name: CATEGORY.name })),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(confirmButton()).toHaveFocus());
    expect(confirmButton()).toHaveAccessibleDescription(
      t(categories.deleteConfirm, { name: CATEGORY.name }),
    );
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  test("Keep goes back without deleting and focuses Delete", async () => {
    await startConfirm();
    await userEvent.click(
      screen.getByRole("button", { name: categories.keep }),
    );
    await vi.waitFor(() => expect(deleteButton()).toHaveFocus());
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  test("confirming sends the id", async () => {
    vi.mocked(deleteCategory).mockResolvedValue({ formError: "stale" });
    await startConfirm();
    await userEvent.click(confirmButton());
    const formData = vi.mocked(deleteCategory).mock.calls[0][1];
    expect(formData.get("id")).toBe(CATEGORY.id);
  });

  // The row unmounts in the same commit as the action's state.
  test("a delete toasts and focuses the heading even as its row unmounts", async () => {
    vi.mocked(deleteCategory).mockImplementation(async () => {
      removeRow();
      return { flash: "categoryDeleted" };
    });
    await startConfirm();

    await userEvent.click(confirmButton());

    expect(screen.queryByRole("button", { name: DELETE })).toBeNull();
    expect(getActiveToast()?.key).toBe("categoryDeleted");
    expect(
      screen.getByRole("heading", { name: categories.listHeading }),
    ).toHaveFocus();
  });

  test("a stale delete shows only the focused stale notice", async () => {
    vi.mocked(deleteCategory).mockResolvedValue({ formError: "stale" });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.stale),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getActiveToast()).toBeNull();
  });

  test("an in-use refusal shows only the focused in-use notice", async () => {
    vi.mocked(deleteCategory).mockResolvedValue({ formError: "inUse" });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(categories.inUseRefusal);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(categories.inUseRefusal),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getActiveToast()).toBeNull();
  });

  test("an unexpected failure keeps the confirm step to retry", async () => {
    vi.mocked(deleteCategory).mockResolvedValue({ formError: "unexpected" });
    await startConfirm();
    await userEvent.click(confirmButton());

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(confirmButton()).toBeInTheDocument();
  });
});
