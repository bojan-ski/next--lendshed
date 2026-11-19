import Form from "next/form";
import Button from "@/components/ui/Button";
import TextInput from "@/components/ui/TextInput";
import { ITEM_TITLE_MAX } from "@/lib/schemas/items";
import { home } from "@/strings/home";

const FIELD_ID = "browse-search";

// A GET form to "/": no page field, so a search always lands on page 1, and
// the selected category travels as a hidden input. Not keyed by `q` (a remount
// would drop focus after every search), as MemberSearchForm.
// Sits on the green band; inside the white pill the focus ring is accent again.
export default function BrowseSearchForm({
  q,
  category,
}: {
  q: string;
  category: string | null;
}) {
  return (
    <Form action="/" role="search" className="flex min-w-0 flex-col gap-2.5">
      <label htmlFor={FIELD_ID} className="font-bold">
        {home.searchLabel}
      </label>
      <div className="flex gap-1.5 rounded-full bg-card p-1.5 [--focus-ring:var(--color-accent)]">
        <TextInput
          id={FIELD_ID}
          type="search"
          name="q"
          defaultValue={q}
          maxLength={ITEM_TITLE_MAX}
          autoComplete="off"
          className="h-12 min-w-0 flex-1 rounded-full border-0 bg-transparent px-4 text-lg"
        />
        {category && <input type="hidden" name="category" value={category} />}
        <Button type="submit" className="shrink-0 px-5 sm:px-7">
          {home.search}
        </Button>
      </div>
    </Form>
  );
}
