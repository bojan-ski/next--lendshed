import type { IconName } from "@/components/ui/icons";
import type { MemberStatus } from "@/generated/prisma/enums";
import { status as labels } from "@/strings/status";
import type { EffectiveLoanStatus } from "@/types/loan";

// One place that decides how every status looks (spec section 12).
// Loan statuses are the *effective* status from the helper in spec 7.3,
// so "overdue" appears here even though it is never stored.

export type Tone = "neutral" | "positive" | "overdue" | "done";

export const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-ink",
  positive: "bg-accent-soft text-accent",
  overdue: "bg-overdue text-white",
  done: "bg-done-soft text-muted",
};

export type StatusStyle = { label: string; icon: IconName; tone: Tone };

export const loanStatus: Record<EffectiveLoanStatus, StatusStyle> = {
  requested: { label: labels.loan.requested, icon: "clock", tone: "neutral" },
  approved: { label: labels.loan.approved, icon: "check", tone: "positive" },
  out: { label: labels.loan.out, icon: "arrow-up-right", tone: "positive" },
  overdue: { label: labels.loan.overdue, icon: "alert", tone: "overdue" },
  returned: { label: labels.loan.returned, icon: "dot", tone: "done" },
  declined: { label: labels.loan.declined, icon: "dot", tone: "done" },
  cancelled: { label: labels.loan.cancelled, icon: "dot", tone: "done" },
  expired: { label: labels.loan.expired, icon: "dot", tone: "done" },
  lapsed: { label: labels.loan.lapsed, icon: "dot", tone: "done" },
};

// The Prisma enum arrives with items (spec 09); until then this union is the contract.
export type ItemStatus = "listed" | "hidden" | "retired";

export const itemStatus: Record<ItemStatus, StatusStyle> = {
  listed: { label: labels.item.listed, icon: "eye", tone: "positive" },
  hidden: { label: labels.item.hidden, icon: "eye-off", tone: "done" },
  retired: { label: labels.item.retired, icon: "dot", tone: "done" },
};

export const memberStatus: Record<MemberStatus, StatusStyle> = {
  active: { label: labels.member.active, icon: "dot", tone: "positive" },
  suspended: { label: labels.member.suspended, icon: "pause", tone: "done" },
};

export const freeToday: StatusStyle = {
  label: labels.freeToday,
  icon: "dot",
  tone: "positive",
};
