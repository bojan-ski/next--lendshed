import ItemDetailsForm from "@/components/items/ItemDetailsForm";
import StepLine from "@/components/items/StepLine";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import Notice from "@/components/ui/Notice";
import { getCategories } from "@/data/categories";
import { countActiveOwnItems } from "@/data/items";
import { requireViewer } from "@/lib/auth/guards";
import { ITEM_CAP } from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { items } from "@/strings/items";

// Guards itself: the (app) layout doesn't re-run on a soft navigation. At the
// cap the form isn't offered; createItem still enforces it.
export default async function NewItemSection() {
  const viewer = await requireViewer();
  const [activeCount, categories] = await Promise.all([
    countActiveOwnItems(viewer.id),
    getCategories(),
  ]);

  if (activeCount >= ITEM_CAP) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="info">{t(items.capNotice, { cap: ITEM_CAP })}</Notice>
        <ButtonLink
          href="/my/items"
          variant="outline"
          className="max-sm:w-full sm:self-start"
        >
          {items.back}
        </ButtonLink>
      </div>
    );
  }
  if (categories.length === 0) {
    return <Notice tone="info">{items.noCategories}</Notice>;
  }

  return (
    <>
      <StepLine step={1} text={items.stepDetails} />
      <Card className="p-5 sm:px-8 sm:py-7.5">
        <ItemDetailsForm categories={categories} />
      </Card>
    </>
  );
}
