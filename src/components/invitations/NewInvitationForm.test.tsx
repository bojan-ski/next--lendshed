import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInvitation } from "@/actions/invitations";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { invitations } from "@/strings/invitations";
import { oneTimeLink } from "@/strings/oneTimeLink";
import type { InvitationFormState } from "@/types/invitation";
import NewInvitationForm from "./NewInvitationForm";

vi.mock("@/actions/invitations", () => ({
  joinWithInvitation: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

const URL_ = `http://localhost:3000/invite/${"A".repeat(43)}`;

async function submitWith(state: InvitationFormState, note = "Mira, no. 14") {
  vi.mocked(createInvitation).mockResolvedValue(state);
  render(<NewInvitationForm />);
  if (note)
    await userEvent.type(screen.getByLabelText(invitations.noteLabel), note);
  await userEvent.click(
    screen.getByRole("button", { name: invitations.submit }),
  );
}

// Set after userEvent has run: its setup installs its own clipboard stub.
function setClipboard(value: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NewInvitationForm", () => {
  test("a created link shows the one-time panel, focused, and clears the note", async () => {
    await submitWith({ created: { url: URL_, note: "Mira, no. 14" } });

    const heading = await screen.findByRole("heading", {
      name: t(oneTimeLink.headingFor, { note: "Mira, no. 14" }),
    });
    expect(heading).toHaveFocus();
    expect(screen.getByLabelText(oneTimeLink.fieldLabel)).toHaveValue(URL_);
    expect(screen.getByLabelText(oneTimeLink.fieldLabel)).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByText(oneTimeLink.warning)).toBeInTheDocument();
    expect(screen.getByLabelText(invitations.noteLabel)).toHaveValue("");
  });

  test("a link without a note gets the plain heading", async () => {
    await submitWith({ created: { url: URL_, note: null } }, "");
    expect(
      await screen.findByRole("heading", { name: oneTimeLink.heading }),
    ).toBeInTheDocument();
  });

  test("a note error keeps the typed note and focuses it", async () => {
    await submitWith({ fieldErrors: { note: [invitations.noteTooLong] } });
    const note = screen.getByLabelText(invitations.noteLabel);
    expect(
      await screen.findByText(invitations.noteTooLong),
    ).toBeInTheDocument();
    expect(note).toHaveValue("Mira, no. 14");
    expect(note).toHaveFocus();
    expect(screen.queryByText(oneTimeLink.warning)).toBeNull();
  });

  test("an unexpected failure focuses the notice", async () => {
    await submitWith({ formError: "unexpected" });
    await screen.findByText(errors.actionFailed);
    expect(document.activeElement).toHaveTextContent(errors.actionFailed);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("OneTimeLinkPanel copy", () => {
  async function renderPanel() {
    await submitWith({ created: { url: URL_, note: null } }, "");
    await screen.findByRole("heading", { name: oneTimeLink.heading });
    return screen.getByRole("button", { name: oneTimeLink.copy });
  }

  test("copies the link, then shows Copied and announces it for about 2 s", async () => {
    const button = await renderPanel();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(button).toHaveTextContent(oneTimeLink.copied);
    expect(screen.getByRole("status")).toHaveTextContent(
      oneTimeLink.copiedAnnouncement,
    );
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(button).toHaveTextContent(oneTimeLink.copy);
  });

  test.each([
    ["rejects", { writeText: vi.fn().mockRejectedValue(new Error("denied")) }],
    ["is missing", undefined],
  ])(
    "when the clipboard %s, the link is selected for a manual copy",
    async (_label, clipboard) => {
      const button = await renderPanel();
      setClipboard(clipboard);

      await act(async () => {
        fireEvent.click(button);
      });

      const field = screen.getByLabelText<HTMLInputElement>(
        oneTimeLink.fieldLabel,
      );
      expect(field).toHaveFocus();
      expect(field).toHaveAccessibleDescription(
        expect.stringContaining(oneTimeLink.copyFailed),
      );
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(URL_.length);
      expect(screen.getByRole("status")).toHaveTextContent(
        oneTimeLink.copyFailed,
      );
      expect(button).toHaveTextContent(oneTimeLink.copy);
    },
  );
});
