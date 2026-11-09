import Container from "@/components/shell/Container";
import Wordmark from "@/components/shell/Wordmark";

export default function SignedOutHeader() {
  return (
    <header className="border-b border-line bg-card">
      <Container className="py-2">
        <Wordmark />
      </Container>
    </header>
  );
}
