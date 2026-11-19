import { Icon } from "@/components/ui/icons";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";

type RequestLengthLineProps = {
  id: string;
  length: number;
  ownerName: string;
  maxLoanDays: number;
};

// "N days · {owner} lends this for up to M days", under the To field.
export default function RequestLengthLine({
  id,
  length,
  ownerName,
  maxLoanDays,
}: RequestLengthLineProps) {
  return (
    <p id={id} className="flex items-center gap-2 text-sm text-on-accent-highlight">
      <Icon name="calendar" aria-hidden className="shrink-0" />
      {t(requestForm.lengthLine, {
        length:
          length === 1
            ? requestForm.lengthOne
            : t(requestForm.lengthOther, { days: length }),
        limit: t(
          maxLoanDays === 1
            ? requestForm.lengthLimitOne
            : requestForm.lengthLimitOther,
          { owner: ownerName, max: maxLoanDays },
        ),
      })}
    </p>
  );
}
