import type { IconName } from "@/components/icons";

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

export type LoanStatus =
  | "requested"
  | "approved"
  | "out"
  | "overdue"
  | "returned"
  | "declined"
  | "cancelled"
  | "expired"
  | "lapsed";

export const loanStatus: Record<LoanStatus, StatusStyle> = {
  requested: { label: "Requested", icon: "clock", tone: "neutral" },
  approved: { label: "Approved", icon: "check", tone: "positive" },
  out: { label: "Out", icon: "arrow-up-right", tone: "positive" },
  overdue: { label: "Overdue", icon: "alert", tone: "overdue" },
  returned: { label: "Returned", icon: "dot", tone: "done" },
  declined: { label: "Declined", icon: "dot", tone: "done" },
  cancelled: { label: "Cancelled", icon: "dot", tone: "done" },
  expired: { label: "Expired", icon: "dot", tone: "done" },
  lapsed: { label: "Lapsed", icon: "dot", tone: "done" },
};

export type ItemState = "listed" | "hidden" | "retired";

export const itemState: Record<ItemState, StatusStyle> = {
  listed: { label: "Listed", icon: "eye", tone: "positive" },
  hidden: { label: "Hidden", icon: "eye-off", tone: "done" },
  retired: { label: "Retired", icon: "dot", tone: "done" },
};

export type MemberStatus = "active" | "suspended";

export const memberStatus: Record<MemberStatus, StatusStyle> = {
  active: { label: "Active", icon: "dot", tone: "positive" },
  suspended: { label: "Suspended", icon: "pause", tone: "done" },
};

export const freeToday: StatusStyle = { label: "Free today", icon: "dot", tone: "positive" };
