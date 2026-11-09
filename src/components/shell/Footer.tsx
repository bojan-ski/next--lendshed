import Link from "next/link";
import Container from "@/components/shell/Container";
import { footer } from "@/strings/footer";

const linkClasses =
  "inline-flex min-h-11 items-center font-bold text-accent underline underline-offset-4";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <Container className="py-4">
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
      </Container>
    </footer>
  );
}
