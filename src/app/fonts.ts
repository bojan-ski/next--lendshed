import {
  Atkinson_Hyperlegible_Next,
  Bricolage_Grotesque,
} from "next/font/google";

// Self-hosted at build time by next/font: no request to Google at runtime.
// Use on <html>: className={`${atkinson.variable} ${bricolage.variable}`}.
// globals.css reads the variables.
export const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-atkinson",
});

// Display face for headings, card titles and big numbers only. Variable, so
// the optical-size axis follows the font size.
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-bricolage",
});
