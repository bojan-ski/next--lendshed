import { Atkinson_Hyperlegible_Next } from "next/font/google";

// Self-hosted at build time by next/font: no request to Google at runtime.
// Use on <html>: className={atkinson.variable}. globals.css reads the variable.
export const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-atkinson",
});
