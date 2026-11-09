export default function ContentSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="h-9 w-2/3 rounded-control bg-neutral-soft" />
      <div className="h-6 w-1/2 rounded-control bg-neutral-soft" />
      <div className="h-48 rounded-card bg-neutral-soft" />
    </div>
  );
}
