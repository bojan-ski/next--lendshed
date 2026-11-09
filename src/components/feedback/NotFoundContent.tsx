import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { errors } from "@/strings/errors";

export default function NotFoundContent() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{errors.notFoundTitle}</h1>
      <EmptyState
        icon="search"
        heading={errors.notFoundHeading}
        body={errors.notFoundBody}
        action={
          <ButtonLink href="/" variant="outline">
            {errors.notFoundAction}
          </ButtonLink>
        }
      />
    </div>
  );
}
