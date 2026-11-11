import Form from "next/form";
import Button from "@/components/ui/Button";
import TextInput from "@/components/ui/TextInput";
import { ITEM_TITLE_MAX } from "@/lib/schemas/items";
import { home } from "@/strings/home";

const FIELD_ID = "browse-search";

// A GET form to "/": no page field, so a search always lands on page 1, and
// the selected category travels as a hidden input. Not keyed by `q` (a remount
// would drop focus after every search), as MemberSearchForm.
export default function BrowseSearchForm({
  q,
  category,
}: {
  q: string;
  category: string | null;
}) {
  return (
    <Form
      action="/"
      role="search"
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="flex flex-col gap-1.5 sm:flex-1">
        <label htmlFor={FIELD_ID} className="font-bold">
          {home.searchLabel}
        </label>
        <TextInput
          id={FIELD_ID}
          type="search"
          name="q"
          defaultValue={q}
          maxLength={ITEM_TITLE_MAX}
          autoComplete="off"
        />
      </div>
      {category && <input type="hidden" name="category" value={category} />}
      <Button type="submit" className="sm:w-auto">
        {home.search}
      </Button>
    </Form>
  );
}
