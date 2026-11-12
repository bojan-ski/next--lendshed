export const loanPage = {
  title: "Loan",
  back: "Back to My loans",
  lengthOne: "(1 day)",
  lengthOther: "({days} days)",
  partyLine: "· {party}",
  party: {
    borrower: "from {owner}",
    owner: "to {borrower}",
    organizer: "{owner} to {borrower}",
  },
  nextHeading: "What happens next",
  // Remaining steps per open status and viewer role; {end} and {due} are dates.
  steps: {
    requested: {
      borrower: [
        "{owner} says yes or no.",
        "If yes, you arrange a pickup with {owner}.",
        "You bring it back by {end}.",
      ],
      owner: [
        "You say yes or no to {borrower}.",
        "If yes, you arrange a pickup and hand it over.",
        "{borrower} brings it back by {end}, and you mark it as back.",
      ],
      organizer: [
        "{owner} says yes or no to {borrower}.",
        "If yes, {owner} hands it over to {borrower}.",
        "{borrower} brings it back by {end}, and {owner} marks it as back.",
      ],
    },
    approved: {
      borrower: [
        "Arrange a pickup with {owner}.",
        "{owner} hands it over.",
        "You bring it back by {end}.",
      ],
      owner: [
        "Arrange a pickup with {borrower}.",
        "You hand it over.",
        "{borrower} brings it back by {end}, and you mark it as back.",
      ],
      organizer: [
        "{owner} and {borrower} arrange a pickup.",
        "{owner} hands it over.",
        "{borrower} brings it back by {end}, and {owner} marks it as back.",
      ],
    },
    out: {
      borrower: ["You bring it back by {end}.", "{owner} marks it as back."],
      owner: ["{borrower} brings it back by {end}.", "You mark it as back."],
      organizer: [
        "{borrower} brings it back to {owner} by {end}.",
        "{owner} marks it as back.",
      ],
    },
    overdue: {
      borrower: [
        "It was due back on {due}. Bring it back to {owner} as soon as you can.",
        "{owner} marks it as back.",
      ],
      owner: [
        "It was due back on {due}. Ask {borrower} to bring it back.",
        "You mark it as back.",
      ],
      organizer: [
        "It was due back on {due}. {borrower} brings it back to {owner}.",
        "{owner} marks it as back.",
      ],
    },
  },
  // One line per ended status; {actor} is "you" or a name.
  ended: {
    returned: "Back on {date}.",
    notAsLent: "It didn't come back as it was lent.",
    closedBy: "Closed by {name}.",
    declined: "Declined by {actor}.",
    cancelled: "Cancelled by {actor}.",
    declinedAuto: "Declined automatically. {reason}",
    cancelledAuto: "Cancelled automatically. {reason}",
    expired: "The request expired: its start date passed without an answer.",
    lapsed: "This lapsed: it wasn't handed over before its end date.",
  },
  you: "you",
  anOrganizer: "an organizer",
  reasons: {
    dates_taken: "Those dates went to another request.",
    item_hidden: "The item was hidden.",
    item_retired: "The item was retired.",
    owner_suspended: "The owner's account is paused.",
    borrower_suspended: "The borrower's account is paused.",
    account_deleted: "An account was deleted.",
  },
  reasonQuote: "“{reason}”",
  messageBorrower: "Your message",
  messageOther: "Message from {borrower}",
  contactHeading: "Contact {name}",
  contactNote: "Shown while the loan is open and for 7 days after.",
} as const;
