import type { Metadata } from "next";
import "./globals.css";
import { atkinson } from "./fonts";
import { t } from "@/lib/text/interpolate";
import { publicEnv } from "@/lib/env/public";
import { app } from "@/strings/app";

const appName = publicEnv.NEXT_PUBLIC_APP_NAME;

export const metadata: Metadata = {
  title: { default: appName, template: t(app.titleTemplate, { appName }) },
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={atkinson.variable}>
      <body className="min-h-dvh bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
