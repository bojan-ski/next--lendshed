export const app = {
  // "%s" is Next's metadata title-template slot, not a t() token.
  titleTemplate: "%s · {appName}",
  // The link-preview card's text (Open Graph and Twitter), same on every page.
  shareDescription:
    "{community}'s shared shed. Neighbours lend each other tools and household gear for free, by invitation only.",
  skipLink: "Skip to main content",
  // Visible text of every back link; its aria-label names the destination.
  back: "Back",
} as const;
