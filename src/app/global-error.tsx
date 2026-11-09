"use client";

import "./globals.css";
import { atkinson } from "./fonts";
import RouteError from "@/components/feedback/RouteError";
import Container from "@/components/shell/Container";
import { errors } from "@/strings/errors";

// Replaces the root layout, so it can't use the Metadata API: React's <title> it is.
export default function GlobalError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <html lang="en" className={atkinson.variable}>
      <body className="min-h-dvh bg-page text-ink antialiased">
        <title>{errors.errorTitle}</title>
        <main id="main" className="py-8">
          <Container>
            <RouteError retry={retry} />
          </Container>
        </main>
      </body>
    </html>
  );
}
