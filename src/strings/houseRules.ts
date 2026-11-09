export const houseRules = {
  isDraft: true,
  title: "House rules",
  intro:
    "{appName} works because neighbours trust each other. These rules keep it that way.",
  sections: [
    {
      heading: "Lending is free",
      items: [
        "Nothing on {appName} is for sale or for rent.",
        "No fees, deposits, tips or advertising.",
        "If you see something that breaks these rules, tell an organizer.",
      ],
    },
    {
      heading: "Borrowing",
      items: [
        "Ask only for the dates you need, and turn up when you agreed.",
        "Look after what you borrow and bring it back clean, on time and as you found it.",
        "If something breaks or goes missing, tell the owner straight away.",
      ],
    },
    {
      heading: "Lending",
      items: [
        "List only things you own and are happy to lend.",
        "Describe the condition honestly and answer requests promptly.",
        "Mark an item as back once it is returned.",
      ],
    },
    {
      heading: "Photos and details",
      items: [
        "Photograph the item only: no people, addresses or documents.",
        "Photo links are private to the community. Don't share them outside {appName}.",
        "Use contact details only to arrange a loan.",
      ],
    },
    {
      heading: "If something goes wrong",
      items: [
        "Lending is at members' own risk. Sort out problems between you first.",
        "An organizer can retire an item or suspend a member who breaks these rules.",
      ],
    },
  ],
} as const;
