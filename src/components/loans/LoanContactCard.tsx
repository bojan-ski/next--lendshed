import Avatar from "@/components/ui/Avatar";
import Card from "@/components/ui/Card";
import { initialsOf } from "@/lib/text/initials";
import { t } from "@/lib/text/interpolate";
import { loanPage } from "@/strings/loanPage";

type LoanContactCardProps = { contact: { name: string; details: string } };

export default function LoanContactCard({ contact }: LoanContactCardProps) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-6">
      <h2 className="truncate text-xl font-bold">
        {t(loanPage.contactHeading, { name: contact.name })}
      </h2>
      <p className="flex min-w-0 items-center gap-3">
        <Avatar initials={initialsOf(contact.name)} aria-hidden />
        <span className="min-w-0 truncate font-bold">{contact.name}</span>
      </p>
      <p className="text-base whitespace-pre-line wrap-break-word">
        {contact.details}
      </p>
      <p className="text-sm text-muted">{loanPage.contactNote}</p>
    </Card>
  );
}
