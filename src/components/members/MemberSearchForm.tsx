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
        className="flex max-w-155 flex-col gap-2"
      >
        <label htmlFor={FIELD_ID} className="font-bold">
          {members.searchLabel}
        </label>
        <div className="flex gap-1.5 rounded-full border-[1.5px] border-field bg-card p-1.5">
          <TextInput
            id={FIELD_ID}
            type="search"
            name="q"
            defaultValue={q}
            maxLength={NAME_MAX}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-full border-0 bg-transparent px-4"
          />
          <Button type="submit" className="shrink-0 px-6">
            {members.search}
          </Button>
        </div>
      </Form>
      {q && (
        <Link
          href="/admin/members"
          className="inline-flex min-h-11 items-center self-start font-bold text-accent-ink underline underline-offset-4"
        >
          {members.showEveryone}
        </Link>
      )}
    </div>
  );
}
