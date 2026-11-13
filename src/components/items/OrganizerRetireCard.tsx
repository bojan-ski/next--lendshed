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
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-xl font-bold">{itemPage.retireHeading}</h2>
      <p className="text-sm text-muted">{itemPage.retireLine}</p>
      <OrganizerRetireForm itemId={itemId} title={title} />
    </Card>
  );
}
