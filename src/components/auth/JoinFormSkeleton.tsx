export default function JoinFormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="h-8 w-3/4 rounded-control bg-neutral-soft" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <div className="h-6 w-24 rounded-control bg-neutral-soft" />
            <div className="h-12 rounded-control bg-neutral-soft" />
          </div>
        ))}
        <div className="h-11 w-2/3 rounded-control bg-neutral-soft" />
        <div className="h-12 rounded-control bg-neutral-soft" />
      </div>
    </div>
  );
}
