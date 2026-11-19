import type { Metadata } from "next";
import "./globals.css";
import { atkinson, bricolage } from "./fonts";
import { t } from "@/lib/text/interpolate";
import { publicEnv } from "@/lib/env/public";
import { env } from "@/lib/env/server";
import { app } from "@/strings/app";

const appName = publicEnv.NEXT_PUBLIC_APP_NAME;
const description = t(app.shareDescription, { community: env.COMMUNITY_NAME });

// One share card for every page: link previews show the app, never a page's data.
export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: { default: appName, template: t(app.titleTemplate, { appName }) },
  description,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: appName,
    title: appName,
    description,
    images: [{ url: "/apple-icon.png", width: 180, height: 180, alt: appName }],
  },
  twitter: { card: "summary", title: appName, description },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${atkinson.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
