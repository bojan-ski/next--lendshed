export const status = {
  loan: {
    requested: "Requested",
    approved: "Approved",
    out: "Out",
    overdue: "Overdue",
    returned: "Returned",
    declined: "Declined",
    cancelled: "Cancelled",
    expired: "Expired",
    lapsed: "Lapsed",
  },
  item: {
    listed: "Listed",
    hidden: "Hidden",
    retired: "Retired",
  },
  member: {
    active: "Active",
    suspended: "Suspended",
  },
  freeToday: "Free today",
} as const;
