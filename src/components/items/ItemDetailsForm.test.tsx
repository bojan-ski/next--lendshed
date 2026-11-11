import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createItem, updateItem } from "@/actions/items";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import {
  ITEM_CAP,
  ITEM_CONDITIONS,
  ITEM_MAX_LOAN_DAYS_DEFAULT,
} from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import type { ItemDetailsFormState, ItemEditDTO } from "@/types/item";
import ItemDetailsForm from "./ItemDetailsForm";

vi.mock("@/actions/items", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  listItem: vi.fn(),
  hideItem: vi.fn(),
  retireOwnItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const CATEGORIES = [
  { id: "cat-1", name: "Garden" },
  { id: "cat-2", name: "Ladders" },
];

const ITEM: ItemEditDTO = {
  id: "item-1",
  title: "Cordless drill",
  description: "Two batteries",
  categoryId: "cat-2",
  condition: "worn",
  maxLoanDays: 10,
  pickupNotes: "Side door",
  status: "hidden",
  photo: null,
  retiredNote: null,
  hasAnyLoan: false,
  hasBlockingLoan: false,
  ownerHasContactDetails: true,
};

afterEach(() => {
  act(() => dismissToast());
});

const field = (label: string) => screen.getByLabelText(label);

async function submit(
  action: typeof createItem,
  state: ItemDetailsFormState,
  item?: ItemEditDTO,
) {
  vi.mocked(action).mockResolvedValue(state);
  render(<ItemDetailsForm categories={CATEGORIES} item={item} />);
  await userEvent.click(
    screen.getByRole("button", {
      name: item ? items.saveChanges : items.saveAndContinue,
    }),
  );
}

describe("ItemDetailsForm", () => {
  test("create mode: empty fields, the default length, the choices and no id", () => {
    const { container } = render(<ItemDetailsForm categories={CATEGORIES} />);

    expect(field(items.titleLabel)).toHaveValue("");
    expect(field(items.categoryLabel)).toHaveValue("");
    expect(field(items.conditionLabel)).toHaveValue("");
    expect(field(items.maxLoanDaysLabel)).toHaveValue(
      ITEM_MAX_LOAN_DAYS_DEFAULT,
    );
    expect(field(items.descriptionLabel).tagName).toBe("TEXTAREA");
    expect(field(items.pickupNotesLabel).tagName).toBe("TEXTAREA");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      items.categoryPlaceholder,
      "Garden",
      "Ladders",
      items.conditionPlaceholder,
      ...ITEM_CONDITIONS.map((condition) => items.condition[condition]),
    ]);
    expect(container.querySelector('input[name="id"]')).toBeNull();
    expect(
      screen.getByRole("button", { name: items.saveAndContinue }),
    ).toBeInTheDocument();
  });

  test("hints describe their fields; no maxLength on the text fields", () => {
    render(<ItemDetailsForm categories={CATEGORIES} />);
    expect(field(items.titleLabel)).toHaveAccessibleDescription(
      items.titleHint,
    );
    expect(field(items.maxLoanDaysLabel)).toHaveAccessibleDescription(
      items.maxLoanDaysHint,
    );
    for (const label of [
      items.titleLabel,
      items.descriptionLabel,
      items.pickupNotesLabel,
    ]) {
      expect(field(label)).not.toHaveAttribute("maxlength");
    }
  });

  test("edit mode: prefilled from the item, with its id and Save changes", () => {
    const { container } = render(
      <ItemDetailsForm categories={CATEGORIES} item={ITEM} />,
    );

    expect(field(items.titleLabel)).toHaveValue(ITEM.title);
    expect(field(items.categoryLabel)).toHaveValue("cat-2");
    expect(field(items.conditionLabel)).toHaveValue("worn");
    expect(field(items.maxLoanDaysLabel)).toHaveValue(10);
    expect(field(items.descriptionLabel)).toHaveValue(ITEM.description);
    expect(field(items.pickupNotesLabel)).toHaveValue(ITEM.pickupNotes);
    expect(container.querySelector('input[name="id"]')).toHaveValue("item-1");
    expect(
      screen.getByRole("button", { name: items.saveChanges }),
    ).toBeInTheDocument();
  });

  test("create mode submits to createItem, edit mode to updateItem with the id", async () => {
    await submit(createItem, {});
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(updateItem).not.toHaveBeenCalled();

    await submit(updateItem, {}, ITEM);
    expect(vi.mocked(updateItem).mock.calls[0][1].get("id")).toBe("item-1");
  });

  test("field errors show under their fields, echo the values and focus the first", async () => {
    await submit(createItem, {
      fieldErrors: {
        title: [items.titleTooShort],
        maxLoanDays: [items.maxLoanDaysRange],
      },
      values: {
        title: "ab",
        categoryId: "cat-1",
        condition: "good",
        maxLoanDays: "31",
        description: "typed",
        pickupNotes: "",
      },
    });

    expect(await screen.findByText(items.titleTooShort)).toBeInTheDocument();
    expect(screen.getByText(items.maxLoanDaysRange)).toBeInTheDocument();
    await vi.waitFor(() => expect(field(items.titleLabel)).toHaveFocus());
    expect(field(items.titleLabel)).toHaveValue("ab");
    expect(field(items.categoryLabel)).toHaveValue("cat-1");
    expect(field(items.maxLoanDaysLabel)).toHaveValue(31);
    expect(field(items.descriptionLabel)).toHaveValue("typed");
    expect(field(items.maxLoanDaysLabel)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test.each([
    ["capReached", t(items.capNotice, { cap: ITEM_CAP })],
    ["unexpected", errors.actionFailed],
  ] as const)(
    "%s focuses the notice, which is not an alert",
    async (formError, text) => {
      await submit(createItem, { formError });

      await screen.findByText(text);
      await vi.waitFor(() =>
        expect(document.activeElement).toHaveTextContent(text),
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  test("a stale save focuses the stale notice", async () => {
    await submit(updateItem, { formError: "stale" }, ITEM);

    await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.stale),
    );
  });

  // A browser drops focus from the disabled pending button; jsdom doesn't, so
  // the action does it here.
  test("a save toasts itemSaved and puts focus back on Save changes", async () => {
    vi.mocked(updateItem).mockImplementation(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      return { flash: "itemSaved" };
    });
    render(<ItemDetailsForm categories={CATEGORIES} item={ITEM} />);
    await userEvent.click(
      screen.getByRole("button", { name: items.saveChanges }),
    );

    await vi.waitFor(() => expect(getActiveToast()?.key).toBe("itemSaved"));
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: items.saveChanges }),
      ).toHaveFocus(),
    );
  });
});
