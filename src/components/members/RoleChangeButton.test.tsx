import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { demoteMember, promoteMember } from "@/actions/members";
import { ROLE_HEADING_ID } from "@/components/members/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import RoleChangeButton from "./RoleChangeButton";

vi.mock("@/actions/members", () => ({
  promoteMember: vi.fn(),
  demoteMember: vi.fn(),
  createResetLink: vi.fn(),
}));

let swapRole: () => void = () => {};

// Stands in for the Role card: the refresh after a change swaps the button
// for the opposite one, keyed by its change as the detail section does.
function RoleCard({ start }: { start: "promote" | "demote" }) {
  const [change, setChange] = useState(start);
  useEffect(() => {
    swapRole = () =>
      setChange((current) => (current === "promote" ? "demote" : "promote"));
  }, []);
  return (
    <section>
      <h2 id={ROLE_HEADING_ID} tabIndex={-1}>
        {members.roleHeading}
      </h2>
      <RoleChangeButton key={change} memberId="m-1" change={change} />
    </section>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

describe("RoleChangeButton", () => {
  test("promote is the primary button and sends the member id", async () => {
    vi.mocked(promoteMember).mockResolvedValue({ formError: "stale" });
    render(<RoleCard start="promote" />);

    await userEvent.click(
      screen.getByRole("button", { name: members.promote }),
    );

    const formData = vi.mocked(promoteMember).mock.calls[0][1];
    expect(formData.get("id")).toBe("m-1");
    expect(demoteMember).not.toHaveBeenCalled();
  });

  // The button remounts in the same commit as the action's state, as with refresh().
  test("a promote toasts, focuses the Role heading and offers the demote button", async () => {
    vi.mocked(promoteMember).mockImplementation(async () => {
      swapRole();
      return { flash: "memberPromoted" };
    });
    render(<RoleCard start="promote" />);

    await userEvent.click(
      screen.getByRole("button", { name: members.promote }),
    );

    expect(
      await screen.findByRole("button", { name: members.demote }),
    ).toBeInTheDocument();
    expect(getActiveToast()?.key).toBe("memberPromoted");
    expect(
      screen.getByRole("heading", { name: members.roleHeading }),
    ).toHaveFocus();
  });

  test("a demote calls demoteMember and toasts", async () => {
    vi.mocked(demoteMember).mockImplementation(async () => {
      swapRole();
      return { flash: "memberDemoted" };
    });
    render(<RoleCard start="demote" />);

    await userEvent.click(screen.getByRole("button", { name: members.demote }));

    expect(
      await screen.findByRole("button", { name: members.promote }),
    ).toBeVisible();
    expect(getActiveToast()?.key).toBe("memberDemoted");
  });

  test.each([
    ["stale", errors.stale],
    ["lastOrganizer", members.lastOrganizer],
    ["self", members.roleSelf],
  ] as const)(
    "a %s refusal replaces the button with its focused notice, no toast",
    async (formError, message) => {
      vi.mocked(demoteMember).mockResolvedValue({ formError });
      render(<RoleCard start="demote" />);

      await userEvent.click(
        screen.getByRole("button", { name: members.demote }),
      );

      const notice = await screen.findByText(message);
      await vi.waitFor(() =>
        expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(getActiveToast()).toBeNull();
    },
  );

  test("an unexpected failure keeps the button for a retry", async () => {
    vi.mocked(promoteMember).mockResolvedValue({ formError: "unexpected" });
    render(<RoleCard start="promote" />);

    await userEvent.click(
      screen.getByRole("button", { name: members.promote }),
    );

    const notice = await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
    );
    expect(screen.getByRole("button", { name: members.promote })).toBeVisible();
  });
});
