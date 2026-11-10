import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { joinWithInvitation } from "@/actions/invitations";
import { resetPasswordWithGrant } from "@/actions/reset";
import JoinForm from "@/components/auth/JoinForm";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { join } from "@/strings/join";
import { linkBroken } from "@/strings/linkBroken";
import { resetPassword } from "@/strings/resetPassword";

vi.mock("@/actions/invitations", () => ({
  joinWithInvitation: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock("@/actions/reset", () => ({ resetPasswordWithGrant: vi.fn() }));

const TOKEN = "A".repeat(43);

// Each island driven to a broken-link result: the markup it leaves behind (the
// page's Card wraps it in both routes), with focus checked on the way.
async function brokenMarkup(
  island: ReactElement,
  submit: string,
): Promise<string> {
  const { container, unmount } = render(island);
  await userEvent.click(screen.getByRole("button", { name: submit }));
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: linkBroken.heading,
  });
  await vi.waitFor(() => expect(heading).toHaveFocus());
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("the broken-link state of both token forms", () => {
  test("JoinForm and ResetPasswordForm render byte-identical markup, focused on its heading", async () => {
    vi.mocked(joinWithInvitation).mockResolvedValue({ linkBroken: true });
    vi.mocked(resetPasswordWithGrant).mockResolvedValue({ linkBroken: true });

    const joinHtml = await brokenMarkup(
      <JoinForm token={TOKEN} community="Elm Street" />,
      join.submit,
    );
    const resetHtml = await brokenMarkup(
      <ResetPasswordForm token={TOKEN} />,
      resetPassword.submit,
    );

    expect(joinHtml).toContain(linkBroken.heading);
    expect(joinHtml).not.toContain("<form");
    expect(resetHtml).toBe(joinHtml);
  });
});
