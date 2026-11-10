import Card from "@/components/ui/Card";

export default function InvitationsTableSkeleton() {
  return (
    <Card aria-hidden className="flex flex-col gap-4 p-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <div className="h-6 rounded-control bg-neutral-soft sm:flex-1" />
          <div className="h-6 w-1/2 rounded-control bg-neutral-soft sm:w-32" />
          <div className="h-12 rounded-control bg-neutral-soft sm:w-28" />
        </div>
      ))}
    </Card>
  );
}
