export const myLoans = {
  title: "My loans",
  tabsLabel: "Loans",
  tabs: {
    borrowing: "Borrowing",
    lending: "Lending",
  },
  groups: {
    needs_you: "Needs you",
    active: "Active",
    past: "Past",
  },
  empty: {
    borrowing: {
      heading: "Nothing borrowed yet",
      body: "When you ask to borrow something, it shows up here.",
      action: "Browse things",
    },
    lending: {
      heading: "Nothing lent yet",
      body: "When a neighbour asks to borrow one of your things, it shows up here.",
      action: "Go to My items",
    },
  },
} as const;
