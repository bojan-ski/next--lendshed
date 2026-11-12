import { account } from "./account";
import { admin } from "./admin";
import { app } from "./app";
import { avatarMenu } from "./avatarMenu";
import { categories } from "./categories";
import { dates } from "./dates";
import { errors } from "./errors";
import { fields } from "./fields";
import { flash } from "./flash";
import { footer } from "./footer";
import { home } from "./home";
import { houseRules } from "./houseRules";
import { invitations } from "./invitations";
import { itemCard } from "./itemCard";
import { itemPage } from "./itemPage";
import { items } from "./items";
import { join } from "./join";
import { linkBroken } from "./linkBroken";
import { loanActions } from "./loanActions";
import { loanCard } from "./loanCard";
import { loanPage } from "./loanPage";
import { login } from "./login";
import { members } from "./members";
import { myLoans } from "./myLoans";
import { nav } from "./nav";
import { oneTimeLink } from "./oneTimeLink";
import { people } from "./people";
import { photos } from "./photos";
import { privacy } from "./privacy";
import { profile } from "./profile";
import { requestForm } from "./requestForm";
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
  categories,
  items,
  photos,
  itemPage,
  profile,
  requestForm,
  loanPage,
  loanActions,
  myLoans,
} as const;

export type FlashKey = keyof typeof strings.flash;
