import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import DeleteItemButton from "@/components/items/DeleteItemButton";
import ItemDetailsForm from "@/components/items/ItemDetailsForm";
import { ITEM_HEADING_ID } from "@/components/items/ids";
import ItemPhotoForm from "@/components/items/ItemPhotoForm";
import ItemReadOnly from "@/components/items/ItemReadOnly";
import ItemVisibilityControl from "@/components/items/ItemVisibilityControl";
import RetireItemButton from "@/components/items/RetireItemButton";
import Card from "@/components/ui/Card";
import StepLine from "@/components/items/StepLine";
import StatusLabel from "@/components/ui/StatusLabel";
import { getCategories } from "@/data/categories";
import { getItemForEdit } from "@/data/items";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { cn } from "@/lib/text/cn";
import { itemStatus } from "@/lib/text/status";
import { items } from "@/strings/items";
import { photos } from "@/strings/photos";
import type { ItemDetailsDefaults, ItemEditDTO } from "@/types/item";

function EditCard({
  id,
  heading,
  green = false,
  className,
  children,
}: {
  id: string;
  heading: string;
  green?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-4 p-6 sm:px-8 sm:py-7.5",
        green && "surface-accent bg-accent",
        className,
      )}
    >
      <h2 id={headingId} className="type-section-title">
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

// Island props serialise to the browser: only what the form fills in.
function detailsDefaults(item: ItemEditDTO): ItemDetailsDefaults {
  const { id, title, description, categoryId, condition } = item;
  const { maxLoanDays, pickupNotes } = item;
  return {
    id,
    title,
    description,
    categoryId,
    condition,
    maxLoanDays,
    pickupNotes,
  };
}

// Guards itself: the (app) layout doesn't re-run on a soft navigation. Someone
// else's item and an unknown id are the same not-found.
export default async function ItemEditSection({
  params,
}: Pick<PageProps<"/my/items/[id]/edit">, "params">) {
  const viewer = await requireViewer();
  const { id } = await params;
  const [item, categories] = await Promise.all([
    getItemForEdit(viewer.id, id, requestToday()),
    getCategories(),
  ]);
  if (!item) notFound();

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1
          id={ITEM_HEADING_ID}
          tabIndex={-1}
          className="type-page-title wrap-break-word"
        >
          {item.title}
        </h1>
        <StatusLabel status={itemStatus[item.status]} />
      </header>
      {item.status !== "retired" && item.photo === null && (
        <StepLine step={2} text={photos.stepLine} />
      )}
      {item.status === "retired" ? (
        <ItemReadOnly
          item={item}
          categoryName={
            categories.find((category) => category.id === item.categoryId)
              ?.name ?? ""
          }
        />
      ) : (
        // DOM order stays Visibility, Photo, Details, Remove; from 1024 px
        // Details takes the right column.
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-7">
          <EditCard
            id="visibility"
            heading={items.visibilityHeading}
            green
            className="lg:col-start-1 lg:row-start-1"
          >
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
          <EditCard
            id="photo"
            heading={items.photoHeading}
            className="lg:col-start-1 lg:row-start-2"
          >
            <ItemPhotoForm
              itemId={item.id}
              title={item.title}
              photo={item.photo}
            />
          </EditCard>
          <EditCard
            id="details"
            heading={items.detailsHeading}
            className="lg:col-start-2 lg:row-span-3 lg:row-start-1"
          >
            <ItemDetailsForm
              categories={categories}
              item={detailsDefaults(item)}
            />
          </EditCard>
          <EditCard
            id="remove"
            heading={items.removeHeading}
            className="lg:col-start-1 lg:row-start-3"
          >
            <RemoveControl item={item} />
          </EditCard>
        </div>
      )}
    </>
  );
}
