export default function JoinFormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      <div className="bg-accent px-6 pt-8 pb-7 sm:px-8 sm:pt-9 sm:pb-8">
        <div className="h-10 w-3/4 rounded-control bg-on-accent-muted opacity-40" />
      </div>
      <div className="flex flex-col gap-4.5 px-6 pt-6 pb-7 sm:px-8 sm:pt-7 sm:pb-8">
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
