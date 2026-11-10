// A one-time link, returned once by the action that made it; never read back.
export type CreatedLinkDTO = {
  url: string;
  note: string | null;
};
