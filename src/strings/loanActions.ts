export const loanActions = {
  heading: "Your decision",
  approve: "Approve",
  decline: "Decline",
  declineQuestion: "Decline this request?",
  declineConfirm: "Decline request",
  cancelRequest: "Cancel request",
  cancelLoan: "Cancel loan",
  cancelRequestQuestion: "Cancel this request?",
  cancelLoanQuestion: "Cancel this loan?",
  cancelRequestConfirm: "Cancel request",
  cancelLoanConfirm: "Cancel loan",
  keep: "Keep it",
  reasonLabel: "Reason (optional)",
  reasonHintBorrower: "The borrower sees this.",
  reasonHintOther: "The other person sees this.",
  reasonTooLong: "Keep the reason to {max} characters or fewer.",
  overlapOne:
    "Another request overlaps these dates. Approving this one declines it.",
  overlapOther:
    "{count} other requests overlap these dates. Approving this one declines them.",
} as const;
