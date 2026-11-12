export const loanCard = {
  party: {
    borrowing: "from {name} · {dateRange}",
    lending: "to {name} · {dateRange}",
  },
  changed: "Changed since you last looked",
  openLoan: "Open loan",
  // Per needsYou kind; {name} is the other party, {date} the end date. A name
  // can end in an initial ("Ruth K."), so no line ends with {name}.
  nextStep: {
    review_request: "{name} asked to borrow it. Say yes or no.",
    hand_over: "Arrange a time with {name} to hand it over.",
    arrange_pickup: "Arrange a time with {name} to pick it up.",
    due_back: "Due back today. {name} is expecting it.",
  },
  overdue: {
    lending: "It was due back on {date}. Ask {name} to bring it back.",
    borrowing: "It was due back on {date}. {name} is waiting for it.",
  },
} as const;
