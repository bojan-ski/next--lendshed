import type { Metadata } from "next";
import "./globals.css";
import { atkinson } from "./fonts";

export const metadata: Metadata = {
  title: "Lendshed",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={atkinson.variable}>
      <body className="min-h-dvh bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
