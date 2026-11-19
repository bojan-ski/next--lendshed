import Link from "next/link";
import { Suspense } from "react";
import Container from "@/components/shell/Container";
import Copyright from "@/components/shell/Copyright";
import { textLinkClasses } from "@/components/ui/link-styles";
import { footer } from "@/strings/footer";

const linkClasses = `inline-flex min-h-11 items-center ${textLinkClasses}`;

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <Container className="flex flex-col gap-2 py-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <nav aria-label={footer.label}>
          <ul className="flex flex-wrap items-center gap-x-3">
            <li>
              <Link href="/house-rules" className={linkClasses}>
                {footer.houseRules}
              </Link>
            </li>
            <li aria-hidden className="text-muted">
              {footer.separator}
            </li>
            <li>
              <Link href="/privacy" className={linkClasses}>
                {footer.privacy}
              </Link>
            </li>
          </ul>
        </nav>
        <div className="min-h-5">
          {/* The year is read at request time; static shells stream it in. */}
          <Suspense fallback={null}>
            <Copyright />
          </Suspense>
        </div>
      </Container>
    </footer>
  );
}
