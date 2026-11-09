import { app } from "./app";
import { errors } from "./errors";
import { fields } from "./fields";
import { flash } from "./flash";
import { footer } from "./footer";
import { home } from "./home";
import { houseRules } from "./houseRules";
import { itemCard } from "./itemCard";
import { loanCard } from "./loanCard";
import { nav } from "./nav";
import { privacy } from "./privacy";
import { status } from "./status";
import { toast } from "./toast";

// Client components import block files directly, never this object.
export const strings = {
  app,
  nav,
  footer,
  home,
  errors,
  toast,
  flash,
  status,
  fields,
  itemCard,
  loanCard,
  houseRules,
  privacy,
} as const;

export type FlashKey = keyof typeof strings.flash;
