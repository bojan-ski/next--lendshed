export const app = {
  // "%s" is Next's metadata title-template slot, not a t() token.
  titleTemplate: "%s · {appName}",
  skipLink: "Skip to main content",
  // Visible text of every back link; its aria-label names the destination.
  back: "Back",
} as const;
