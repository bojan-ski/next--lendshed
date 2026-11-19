// Reserves the label's bold width, so the current item's weight never shifts
// its neighbours. The hidden copy is generated content with empty alt text:
// not in the DOM, the link's name or textContent.
export default function NavLabel({ children }: { children: string }) {
  return (
    <span
      data-label={children}
      className="inline-flex flex-col after:invisible after:h-0 after:overflow-hidden after:font-bold after:content-[attr(data-label)_/_'']"
    >
      {children}
    </span>
  );
}
