import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createResetLink } from "@/actions/members";
import { getActiveToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import { oneTimeLink } from "@/strings/oneTimeLink";
import ResetLinkForm from "./ResetLinkForm";

vi.mock("@/actions/members", () => ({
  promoteMember: vi.fn(),
  demoteMember: vi.fn(),
  createResetLink: vi.fn(),
}));

const linkFor = (char: string) =>
  `http://localhost:3000/reset/${char.repeat(43)}`;
const panelHeading = () =>
  screen.getByRole("heading", {
    name: t(oneTimeLink.headingFor, { note: "Mira K." }),
  });
const createButton = () =>
  screen.getByRole("button", { name: members.createResetLink });

describe("ResetLinkForm", () => {
  test("sends the member id", async () => {
    vi.mocked(createResetLink).mockResolvedValue({ formError: "stale" });
    render(<ResetLinkForm memberId="m-1" />);
    await userEvent.click(createButton());
    expect(vi.mocked(createResetLink).mock.calls[0][1].get("id")).toBe("m-1");
  });

  test("a created link shows the one-time panel for the member, focused, and no toast", async () => {
    vi.mocked(createResetLink).mockResolvedValue({
      created: { url: linkFor("A"), note: "Mira K." },
    });
    render(<ResetLinkForm memberId="m-1" />);

    await userEvent.click(createButton());

    await vi.waitFor(() => expect(panelHeading()).toHaveFocus());
    expect(screen.getByLabelText(oneTimeLink.fieldLabel)).toHaveValue(
      linkFor("A"),
    );
    expect(getActiveToast()).toBeNull();
  });

  test("creating again replaces the panel with the new link and refocuses it", async () => {
    vi.mocked(createResetLink)
      .mockResolvedValueOnce({
        created: { url: linkFor("A"), note: "Mira K." },
      })
      .mockResolvedValueOnce({
        created: { url: linkFor("B"), note: "Mira K." },
      });
    render(<ResetLinkForm memberId="m-1" />);

    await userEvent.click(createButton());
    await userEvent.click(createButton());

    await vi.waitFor(() =>
      expect(screen.getByLabelText(oneTimeLink.fieldLabel)).toHaveValue(
        linkFor("B"),
      ),
    );
    expect(screen.getAllByLabelText(oneTimeLink.fieldLabel)).toHaveLength(1);
    await vi.waitFor(() => expect(panelHeading()).toHaveFocus());
  });

  test.each([
    ["self", members.resetSelf],
    ["stale", errors.stale],
    ["unexpected", errors.actionFailed],
  ] as const)(
    "a %s refusal shows its focused notice",
    async (formError, message) => {
      vi.mocked(createResetLink).mockResolvedValue({ formError });
      render(<ResetLinkForm memberId="m-1" />);

      await userEvent.click(createButton());

      await vi.waitFor(() =>
        expect(
          screen.getByText(message).closest("[tabindex='-1']"),
        ).toHaveFocus(),
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByLabelText(oneTimeLink.fieldLabel)).toBeNull();
    },
  );
});
