import { controlClasses } from "@/components/ui/control-styles";
import Field from "@/components/ui/Field";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { ITEM_CONDITIONS, ITEM_MAX_LOAN_DAYS } from "@/lib/schemas/items";
import { items } from "@/strings/items";
import type { CategoryDTO } from "@/types/categories";
import type { ItemDetailsField, ItemDetailsFormState } from "@/types/item";

type ItemDetailsFieldsProps = {
  categories: CategoryDTO[];
  values: Record<ItemDetailsField, string>;
  errors: ItemDetailsFormState["fieldErrors"];
};

// The six fields of ItemDetailsForm; no maxLength, since the limits are counted
// on the server after CRLF normalisation. A select only takes defaultValue when
// it mounts (the form reset after a submit goes back to that), so each one is
// keyed by its value to show the echoed choice.
export default function ItemDetailsFields({
  categories,
  values,
  errors,
}: ItemDetailsFieldsProps) {
  return (
    <>
      <Field
        id="item-title"
        label={items.titleLabel}
        hint={items.titleHint}
        errors={errors?.title}
      >
        {(control) => (
          <TextInput
            {...control}
            name="title"
            autoComplete="off"
            aria-required
            defaultValue={values.title}
          />
        )}
      </Field>
      <Field
        id="item-category"
        label={items.categoryLabel}
        errors={errors?.categoryId}
      >
        {(control) => (
          <select
            key={values.categoryId}
            {...control}
            name="categoryId"
            aria-required
            defaultValue={values.categoryId}
            className={controlClasses("h-12")}
          >
            <option value="">{items.categoryPlaceholder}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        id="item-condition"
        label={items.conditionLabel}
        errors={errors?.condition}
      >
        {(control) => (
          <select
            key={values.condition}
            {...control}
            name="condition"
            aria-required
            defaultValue={values.condition}
            className={controlClasses("h-12")}
          >
            <option value="">{items.conditionPlaceholder}</option>
            {ITEM_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {items.condition[condition]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        id="item-max-loan-days"
        label={items.maxLoanDaysLabel}
        hint={items.maxLoanDaysHint}
        errors={errors?.maxLoanDays}
      >
        {(control) => (
          <TextInput
            {...control}
            type="number"
            name="maxLoanDays"
            inputMode="numeric"
            min={1}
            max={ITEM_MAX_LOAN_DAYS}
            aria-required
            defaultValue={values.maxLoanDays}
            className="sm:max-w-40"
          />
        )}
      </Field>
      <Field
        id="item-description"
        label={items.descriptionLabel}
        hint={items.descriptionHint}
        errors={errors?.description}
      >
        {(control) => (
          <TextArea
            {...control}
            name="description"
            rows={5}
            defaultValue={values.description}
          />
        )}
      </Field>
      <Field
        id="item-pickup-notes"
        label={items.pickupNotesLabel}
        hint={items.pickupNotesHint}
        errors={errors?.pickupNotes}
      >
        {(control) => (
          <TextArea
            {...control}
            name="pickupNotes"
            rows={3}
            defaultValue={values.pickupNotes}
          />
        )}
      </Field>
    </>
  );
}
