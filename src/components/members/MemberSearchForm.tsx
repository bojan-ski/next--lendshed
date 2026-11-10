import Form from "next/form";
import Link from "next/link";
import Button from "@/components/ui/Button";
import TextInput from "@/components/ui/TextInput";
import { NAME_MAX } from "@/lib/schemas/limits";
import { members } from "@/strings/members";

const FIELD_ID = "member-search";

// A GET form: the URL holds the search. Not keyed by `q`: a remount would drop
// keyboard focus after every search. After "Show everyone" or Back the field
// may keep its old text; the count line says what is shown.
export default function MemberSearchForm({ q }: { q: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Form
        action="/admin/members"
        role="search"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex flex-col gap-1.5 sm:flex-1">
          <label htmlFor={FIELD_ID} className="font-bold">
            {members.searchLabel}
          </label>
          <TextInput
            id={FIELD_ID}
            type="search"
            name="q"
            defaultValue={q}
            maxLength={NAME_MAX}
            autoComplete="off"
          />
        </div>
        <Button type="submit" className="sm:w-auto">
          {members.search}
        </Button>
      </Form>
      {q && (
        <Link
          href="/admin/members"
          className="inline-flex min-h-11 items-center self-start font-bold text-accent underline underline-offset-4"
        >
          {members.showEveryone}
        </Link>
      )}
    </div>
  );
}
