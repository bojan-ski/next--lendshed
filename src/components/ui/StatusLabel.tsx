import { Icon } from "@/components/ui/icons";
import { toneClasses, type StatusStyle } from "@/lib/text/status";

// A status is always text plus an icon, never colour alone.
// Usage: <StatusLabel status={loanStatus[effectiveStatus(loan)]} />
export default function StatusLabel({ status }: { status: StatusStyle }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold whitespace-nowrap ${toneClasses[status.tone]}`}
    >
      <Icon name={status.icon} size={status.icon === "dot" ? 10 : 16} />
      {status.label}
    </span>
  );
}
