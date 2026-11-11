import OwnItemsTable from "@/components/items/OwnItemsTable";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/icons";
import { getOwnItems } from "@/data/items";
import { requireViewer } from "@/lib/auth/guards";
import { communityToday } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { items } from "@/strings/items";

function AddItemLink() {
  return (
    <ButtonLink href="/my/items/new" className="max-sm:w-full">
      <Icon name="plus" aria-hidden />
      {items.addItem}
    </ButtonLink>
  );
}

// Guards itself: the (app) layout doesn't re-run on a soft navigation.
export default async function OwnItemsSection() {
  const viewer = await requireViewer();
  const { rows, activeCount, cap } = await getOwnItems(
    viewer.id,
    communityToday(),
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="box-open"
        heading={items.emptyHeading}
        body={items.emptyBody}
        action={<AddItemLink />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {t(items.countLine, { count: activeCount, cap })}
        </p>
        {activeCount >= cap ? (
          <p className="text-sm text-muted">{t(items.capLine, { cap })}</p>
        ) : (
          <AddItemLink />
        )}
      </div>
      <OwnItemsTable rows={rows} />
    </div>
  );
}
