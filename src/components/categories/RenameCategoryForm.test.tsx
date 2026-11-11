import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renameCategory } from "@/actions/categories";
import { CATEGORIES_HEADING_ID } from "@/components/categories/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { categories } from "@/strings/categories";
import { errors } from "@/strings/errors";
import RenameCategoryForm from "./RenameCategoryForm";

vi.mock("@/actions/categories", () => ({
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

const CATEGORY = { id: "cat-1", name: "Garden" };
const RENAME = t(categories.renameFor, { name: CATEGORY.name });
const FIELD = t(categories.renameLabel, { name: CATEGORY.name });

function Page() {
  return (
    <>
      <h2 id={CATEGORIES_HEADING_ID} tabIndex={-1}>
        {categories.listHeading}
      </h2>
      <RenameCategoryForm category={CATEGORY} />
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const renameButton = () => screen.getByRole("button", { name: RENAME });
const field = () => screen.getByLabelText(FIELD);

async function open() {
  render(<Page />);
  await userEvent.click(renameButton());
}

describe("RenameCategoryForm", () => {
  test("names its category, starting with the visible text", () => {
    render(<Page />);
    expect(renameButton()).toHaveTextContent(categories.rename);
    expect(RENAME.startsWith(categories.rename)).toBe(true);
  });

  test("opening shows the current name in a focused field", async () => {
    await open();
    await vi.waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveValue(CATEGORY.name);
    expect(field()).toHaveAccessibleDescription(categories.nameHint);
  });

  test("Cancel closes the editor and returns focus to Rename", async () => {
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: categories.cancel }),
    );
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    await vi.waitFor(() => expect(renameButton()).toHaveFocus());
    expect(renameCategory).not.toHaveBeenCalled();
  });

  test("sends the id and the typed name", async () => {
    vi.mocked(renameCategory).mockResolvedValue({ flash: "categoryRenamed" });
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "Garden tools");
    await userEvent.click(
      screen.getByRole("button", { name: categories.save }),
    );
    const formData = vi.mocked(renameCategory).mock.calls[0][1];
    expect(formData.get("id")).toBe(CATEGORY.id);
    expect(formData.get("name")).toBe("Garden tools");
  });

  test("a duplicate keeps the typed name, focused, with the editor open", async () => {
    vi.mocked(renameCategory).mockResolvedValue({
      fieldErrors: { name: [categories.nameTaken] },
      values: { name: "kids" },
    });
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "kids");
    await userEvent.click(
      screen.getByRole("button", { name: categories.save }),
    );

    await screen.findByText(categories.nameTaken);
    expect(field()).toHaveValue("kids");
    await vi.waitFor(() => expect(field()).toHaveFocus());
    expect(getActiveToast()).toBeNull();
  });

  test("a rename toasts, closes the editor and focuses the section heading", async () => {
    vi.mocked(renameCategory).mockResolvedValue({ flash: "categoryRenamed" });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: categories.save }),
    );

    await screen.findByRole("button", { name: RENAME });
    expect(getActiveToast()?.key).toBe("categoryRenamed");
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    expect(
      screen.getByRole("heading", { name: categories.listHeading }),
    ).toHaveFocus();
  });

  test("a stale rename replaces the editor with the focused stale notice", async () => {
    vi.mocked(renameCategory).mockResolvedValue({ formError: "stale" });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: categories.save }),
    );

    await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.stale),
    );
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("an unexpected failure keeps the editor to retry, notice focused", async () => {
    vi.mocked(renameCategory).mockResolvedValue({ formError: "unexpected" });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: categories.save }),
    );

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(field()).toBeInTheDocument();
  });
});
