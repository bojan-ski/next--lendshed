import Avatar from "@/components/ui/Avatar";
import { initialsOf } from "@/lib/text/initials";
import { t } from "@/lib/text/interpolate";
import { loanPage } from "@/strings/loanPage";

type LoanContactCardProps = { contact: { name: string; details: string } };

export default function LoanContactCard({ contact }: LoanContactCardProps) {
  return (
    <div className="surface-accent flex min-w-0 flex-col gap-4 rounded-card p-6 sm:px-8 sm:py-7.5">
      <h2 className="truncate type-section-title">
        {t(loanPage.contactHeading, { name: contact.name })}
      </h2>
      <p className="flex min-w-0 items-center gap-3.5">
        <Avatar
          initials={initialsOf(contact.name)}
          aria-hidden
          className="size-12 bg-on-accent-highlight text-ink"
        />
        <span className="min-w-0 truncate text-lg font-bold">
          {contact.name}
        </span>
      </p>
      <p className="text-xl/normal whitespace-pre-line wrap-break-word">
        {contact.details}
      </p>
      <p className="text-sm text-on-accent-muted">{loanPage.contactNote}</p>
    </div>
  );
}
