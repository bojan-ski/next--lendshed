import Container from "@/components/shell/Container";
import Wordmark from "@/components/shell/Wordmark";

export default function SignedOutHeader() {
  return (
    <header className="bg-card">
      <Container className="py-3 lg:py-4">
        <Wordmark />
      </Container>
    </header>
  );
}
