export const privacy = {
  isDraft: true,
  title: "Privacy",
  intro:
    "{appName} stores as little as it can. This page says what, and who sees it.",
  sections: [
    {
      heading: "What we store",
      items: [
        "Your email address and password (stored scrambled), used only to sign you in.",
        "Your display name and, if you add one, the area you live in.",
        "The contact details you choose to share for arranging loans.",
        "The items you list, with one photo each, and the history of your loans.",
        "No exact addresses and no location data: photo metadata is removed when you upload.",
      ],
    },
    {
      heading: "Who sees what",
      items: [
        "Members see your display name, area and listed items.",
        "Your contact details show only to the other person on an approved or handed-over loan, and for 7 days after it is returned.",
        "Contact details never appear on item pages, in browse, on your profile, or to organizers.",
        "{appName} is private: it is never shown to search engines.",
      ],
    },
    {
      heading: "Deleting your account",
      items: [
        "You can delete your account from the Account page, once nothing is out on loan to or from you.",
        "Your personal details are erased and your items are removed.",
        'Past loans stay in other members\' history, shown as "Former member".',
        "For a copy of your data, ask an organizer.",
      ],
    },
    {
      heading: "Liability",
      items: [
        "Lending and borrowing are at members' own risk.",
        "{appName} and its organizers aren't responsible for loss, damage or injury from anything lent through it.",
      ],
    },
  ],
} as const;
