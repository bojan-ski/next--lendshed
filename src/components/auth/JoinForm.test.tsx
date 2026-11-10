import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { joinWithInvitation } from "@/actions/invitations";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { join } from "@/strings/join";
import { linkBroken } from "@/strings/linkBroken";
import type { JoinState } from "@/types/auth";
import JoinForm from "./JoinForm";

vi.mock("@/actions/invitations", () => ({
  joinWithInvitation: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

const TOKEN = "A".repeat(43);

function renderForm() {
  return render(<JoinForm token={TOKEN} community="Elm Street" />);
}

async function submitWith(state: JoinState) {
  vi.mocked(joinWithInvitation).mockResolvedValue(state);
  renderForm();
  await userEvent.type(screen.getByLabelText(join.nameLabel), "Mira K.");
  await userEvent.type(
    screen.getByLabelText(join.emailLabel),
    "mira@example.com",
  );
  await userEvent.type(
    screen.getByLabelText(join.passwordLabel),
    "correct-horse",
  );
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: join.submit }));
}

describe("JoinForm", () => {
  test("renders the heading, the fields and the token as a hidden input", () => {
    const { container } = renderForm();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      t(join.heading, { community: "Elm Street" }),
    );
    expect(
      container.querySelector('input[type="hidden"][name="token"]'),
    ).toHaveValue(TOKEN);
    expect(screen.getByLabelText(join.nameLabel)).toHaveAccessibleDescription(
      join.nameHint,
    );
    expect(screen.getByLabelText(join.passwordLabel)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    for (const control of [
      screen.getByLabelText(join.nameLabel),
      screen.getByLabelText(join.emailLabel),
      screen.getByLabelText(join.passwordLabel),
      screen.getByRole("checkbox"),
    ]) {
      expect(control).toHaveAttribute("aria-required", "true");
    }
    expect(
      screen.getByRole("link", { name: join.houseRulesLink }),
    ).toHaveAttribute("href", "/house-rules");
  });

  test("field errors render under their fields, echo name and email, clear the password", async () => {
    await submitWith({
      fieldErrors: { email: [join.emailTaken] },
      name: "Mira K.",
      email: "mira@example.com",
    });
    const email = screen.getByLabelText(join.emailLabel);
    expect(await screen.findByText(join.emailTaken)).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
    expect(email).toHaveValue("mira@example.com");
    expect(screen.getByLabelText(join.nameLabel)).toHaveValue("Mira K.");
    expect(screen.getByLabelText(join.passwordLabel)).toHaveValue("");
    // The house-rules box passed validation, so it stays ticked.
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  test("an unticked house-rules box is flagged and focused", async () => {
    await submitWith({
      fieldErrors: { acceptHouseRules: [join.houseRulesRequired] },
      name: "Mira K.",
      email: "mira@example.com",
    });
    await screen.findByText(join.houseRulesRequired);
    const box = screen.getByRole("checkbox");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(join.houseRulesRequired);
    expect(box).toHaveFocus();
    expect(box).not.toBeChecked();
  });

  test("an unexpected failure focuses the notice, which is not also an alert", async () => {
    await submitWith({
      formError: "unexpected",
      name: "Mira K.",
      email: "mira@example.com",
    });
    await screen.findByText(errors.actionFailed);
    expect(document.activeElement).toHaveTextContent(errors.actionFailed);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("a broken link replaces the form and takes focus", async () => {
    await submitWith({ linkBroken: true });
    const heading = await screen.findByRole("heading", {
      name: linkBroken.heading,
    });
    expect(heading).toHaveFocus();
    expect(screen.queryByRole("button", { name: join.submit })).toBeNull();
    expect(screen.queryByLabelText(join.emailLabel)).toBeNull();
    expect(
      screen.getByRole("link", { name: linkBroken.action }),
    ).toHaveAttribute("href", "/login");
  });
});
