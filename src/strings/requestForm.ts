export const requestForm = {
  heading: "Ask to borrow",
  from: "From",
  to: "To",
  lengthOne: "1 day",
  lengthOther: "{days} days",
  lengthLimitOne: "{owner} lends this for up to 1 day",
  lengthLimitOther: "{owner} lends this for up to {max} days",
  lengthLine: "{length} · {limit}",
  message: "Message to {owner} (optional)",
  send: "Send request",
  dateInvalid: "Pick a date.",
  endBeforeStart: "The end date can't be before the start date.",
  messageTooLong: "Keep the message to {max} characters or fewer.",
  startOutOfWindow: "Pick a start date from today up to {days} days ahead.",
  tooLong: "This item can be borrowed for up to {max} days.",
  stale:
    "This item can't be requested any more. Reload to see where it stands.",
  needsContactDetails:
    "Add your contact details first, so the owner can reach you once they say yes.",
  itemLimit: "You already have an open request for this item.",
  overallLimit:
    "You already have {limit} open requests. Wait for an answer before asking for more.",
  datesTaken: "Those dates were just taken. Pick other dates.",
  blockedContactDetails:
    "Add your contact details before you ask to borrow, so the owner can reach you.",
  accountLink: "Add contact details",
} as const;
