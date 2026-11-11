import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import DeleteItemButton from "@/components/items/DeleteItemButton";
import ItemDetailsForm from "@/components/items/ItemDetailsForm";
import { ITEM_HEADING_ID } from "@/components/items/ids";
import ItemReadOnly from "@/components/items/ItemReadOnly";
import ItemVisibilityControl from "@/components/items/ItemVisibilityControl";
import RetireItemButton from "@/components/items/RetireItemButton";
import Card from "@/components/ui/Card";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { getCategories } from "@/data/categories";
import { getItemForEdit } from "@/data/items";
import { requireViewer } from "@/lib/auth/guards";
import { communityToday } from "@/lib/dates/dates";
import { itemStatus } from "@/lib/text/status";
import { items } from "@/strings/items";
import type { ItemEditDTO } from "@/types/item";

function EditCard({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className="flex flex-col gap-4 p-6"
    >
      <h2 id={headingId} className="text-xl font-bold">
        {heading}
      </h2>
      {children}
    </Card>
  );
}

// Exactly one control: Delete with no loan rows, Retire once it has loans but
// none booked or out, and only a line while one is.
function RemoveControl({ item }: { item: ItemEditDTO }) {
  if (!item.hasAnyLoan) {
    return <DeleteItemButton itemId={item.id} title={item.title} />;
  }
  if (!item.hasBlockingLoan) {
    return <RetireItemButton itemId={item.id} title={item.title} />;
  }
  return <p className="text-sm text-muted">{items.blockedLine}</p>;
}

// Guards itself: the (app) layout doesn't re-run on a soft navigation. Someone
// else's item and an unknown id are the same not-found.
export default async function ItemEditSection({
  params,
}: Pick<PageProps<"/my/items/[id]/edit">, "params">) {
  const viewer = await requireViewer();
  const { id } = await params;
  const [item, categories] = await Promise.all([
    getItemForEdit(viewer.id, id, communityToday()),
    getCategories(),
  ]);
  if (!item) notFound();

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1
          id={ITEM_HEADING_ID}
          tabIndex={-1}
          className="text-2xl font-bold wrap-break-word"
        >
          {item.title}
        </h1>
        <StatusLabel status={itemStatus[item.status]} />
      </header>
      {item.status === "retired" ? (
        <ItemReadOnly
          item={item}
          categoryName={
            categories.find((category) => category.id === item.categoryId)
              ?.name ?? ""
          }
        />
      ) : (
        <>
          <EditCard id="visibility" heading={items.visibilityHeading}>
            <p className="text-muted">
              {item.status === "listed"
                ? items.visibilityListed
                : items.visibilityHidden}
            </p>
            <ItemVisibilityControl
              itemId={item.id}
              status={item.status}
              hasPhoto={item.photo !== null}
              ownerHasContactDetails={item.ownerHasContactDetails}
            />
          </EditCard>
          <EditCard id="photo" heading={items.photoHeading}>
            <PhotoPlaceholder
              iconSize={32}
              className="aspect-4/3 w-full max-w-80 rounded-control"
            />
            <p className="text-sm text-muted">{items.photoLine}</p>
          </EditCard>
          <EditCard id="details" heading={items.detailsHeading}>
            <ItemDetailsForm categories={categories} item={item} />
          </EditCard>
          <EditCard id="remove" heading={items.removeHeading}>
            <RemoveControl item={item} />
          </EditCard>
        </>
      )}
    </>
  );
}
