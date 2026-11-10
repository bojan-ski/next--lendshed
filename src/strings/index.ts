import { account } from "./account";
import { admin } from "./admin";
import { app } from "./app";
import { avatarMenu } from "./avatarMenu";
import { dates } from "./dates";
import { errors } from "./errors";
import { fields } from "./fields";
import { flash } from "./flash";
import { footer } from "./footer";
import { home } from "./home";
import { houseRules } from "./houseRules";
import { invitations } from "./invitations";
import { itemCard } from "./itemCard";
import { join } from "./join";
import { linkBroken } from "./linkBroken";
import { loanCard } from "./loanCard";
import { login } from "./login";
import { members } from "./members";
import { nav } from "./nav";
import { oneTimeLink } from "./oneTimeLink";
import { people } from "./people";
import { privacy } from "./privacy";
import { resetPassword } from "./resetPassword";
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
  dates,
  login,
  avatarMenu,
  join,
  invitations,
  admin,
  linkBroken,
  oneTimeLink,
  people,
  account,
  members,
  resetPassword,
} as const;

export type FlashKey = keyof typeof strings.flash;
