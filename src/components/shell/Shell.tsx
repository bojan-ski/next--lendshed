import { Suspense, type ReactNode } from "react";
import Toaster from "@/components/feedback/Toaster";
import Container from "@/components/shell/Container";
import Footer from "@/components/shell/Footer";
import SkipLink from "@/components/shell/SkipLink";

type ShellProps = {
  header: ReactNode;
  children: ReactNode;
};

export default function Shell({ header, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      {header}
      <main id="main" tabIndex={-1} className="flex-1 py-8">
        <Container>{children}</Container>
      </main>
      <Footer />
      {/* usePathname suspends on routes with unknown dynamic params. */}
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </div>
  );
}
