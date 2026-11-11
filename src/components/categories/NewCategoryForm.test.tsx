import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCategory } from "@/actions/categories";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { categories } from "@/strings/categories";
import { errors } from "@/strings/errors";
import type { NewCategoryState } from "@/types/categories";
import NewCategoryForm from "./NewCategoryForm";

vi.mock("@/actions/categories", () => ({
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

afterEach(() => {
  act(() => dismissToast());
});

const field = () => screen.getByLabelText(categories.nameLabel);

async function submitWith(state: NewCategoryState, name = "Garden tools") {
  vi.mocked(createCategory).mockResolvedValue(state);
  render(<NewCategoryForm />);
  if (name) await userEvent.type(field(), name);
  await userEvent.click(screen.getByRole("button", { name: categories.add }));
}

describe("NewCategoryForm", () => {
  test("shows the 2–30 hint and sends the typed name", async () => {
    await submitWith({ flash: "categoryAdded" });
    expect(field()).toHaveAccessibleDescription(categories.nameHint);
    const formData = vi.mocked(createCategory).mock.calls[0][1];
    expect(formData.get("name")).toBe("Garden tools");
  });

  test("an add toasts, empties the field and keeps focus there", async () => {
    await submitWith({ flash: "categoryAdded" });
    await vi.waitFor(() => expect(getActiveToast()?.key).toBe("categoryAdded"));
    await vi.waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveValue("");
  });

  test("a field error keeps the typed name and focuses the field", async () => {
    await submitWith({
      fieldErrors: { name: [categories.nameTaken] },
      values: { name: "Garden tools" },
    });
    await screen.findByText(categories.nameTaken);
    expect(field()).toHaveValue("Garden tools");
    await vi.waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(getActiveToast()).toBeNull();
  });

  test("an unexpected failure focuses the notice, which is not an alert", async () => {
    await submitWith({ formError: "unexpected" });
    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
