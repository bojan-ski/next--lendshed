import OrganizerRetireForm from "@/components/items/OrganizerRetireForm";
import Card from "@/components/ui/Card";
import { itemPage } from "@/strings/itemPage";

// Organizers only, never on their own item (OQ-19, OQ-21).
export default function OrganizerRetireCard({
  itemId,
  title,
}: {
  itemId: string;
  title: string;
}) {
  return (
    <Card className="flex flex-col gap-3 p-6 sm:px-8 sm:py-7.5">
      <h2 className="type-section-title">{itemPage.retireHeading}</h2>
      <p className="text-sm text-muted">{itemPage.retireLine}</p>
      <OrganizerRetireForm itemId={itemId} title={title} />
    </Card>
  );
}
