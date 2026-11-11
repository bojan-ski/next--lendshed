// Never derived from the filename, owner or item, and never reused.
export function newPhotoKey(): string {
  return `items/${crypto.randomUUID()}.webp`;
}
