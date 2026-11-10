export const flash = {
  joined: "Welcome to Lendshed. You're signed in.",
  joinedSignIn: "Your account is ready. Sign in to continue.",
  invitationRevoked: "Invitation revoked.",
  profileSaved: "Profile saved.",
  contactDetailsSaved: "Contact details saved.",
  passwordChanged: "Password changed. Your other devices are signed out.",
} as const satisfies Record<string, string>;
