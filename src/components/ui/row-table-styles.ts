// A table whose rows are separate white bands: the cells share the band's
// background and the outer ones round its ends. Below the breakpoint each row
// stacks as its own card (the table adds its own flex direction and gaps).
export const rowTableLg = {
  table: "w-full border-separate border-spacing-y-2 text-left max-lg:block",
  head: "text-sm text-muted max-lg:sr-only",
  headCell: "px-2 font-normal first:pl-4.5",
  body: "max-lg:flex max-lg:flex-col max-lg:gap-2",
  row: "max-lg:rounded-tile max-lg:bg-card max-lg:p-4",
  cell: "align-middle lg:bg-card lg:px-2 lg:py-2.5 lg:first:rounded-l-tile lg:first:pl-4.5 lg:last:rounded-r-tile lg:last:pr-2.5",
};

export const rowTableSm = {
  table: "w-full border-separate border-spacing-y-2 text-left max-sm:block",
  head: "text-sm text-muted max-sm:sr-only",
  headCell: "px-2 font-normal first:pl-4.5",
  body: "max-sm:flex max-sm:flex-col max-sm:gap-2",
  row: "max-sm:rounded-tile max-sm:bg-card max-sm:p-4",
  cell: "align-middle sm:bg-card sm:px-2 sm:py-2.5 sm:first:rounded-l-tile sm:first:pl-4.5 sm:last:rounded-r-tile sm:last:pr-2.5",
};
