import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { reinstateMember, suspendMember } from "@/actions/members";
import { ACCESS_HEADING_ID } from "@/components/members/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import MemberStatusControl from "./MemberStatusControl";

vi.mock("@/actions/members", () => ({
  promoteMember: vi.fn(),
  demoteMember: vi.fn(),
  createResetLink: vi.fn(),
  suspendMember: vi.fn(),
  reinstateMember: vi.fn(),
}));

let swapStatus: () => void = () => {};

// Stands in for the Access card: the refresh after a change swaps the control
// for the opposite one, keyed by its change as the detail section does.
function AccessCard({
  start,
  isOrganizer = false,
}: {
  start: "suspend" | "reinstate";
  isOrganizer?: boolean;
}) {
  const [change, setChange] = useState(start);
  useEffect(() => {
    swapStatus = () =>
      setChange((current) => (current === "suspend" ? "reinstate" : "suspend"));
  }, []);
  return (
    <section>
      <h2 id={ACCESS_HEADING_ID} tabIndex={-1}>
        {members.accessHeading}
      </h2>
      <MemberStatusControl
        key={change}
        memberId="m-1"
        memberName="Mira K."
        change={change}
        isOrganizer={isOrganizer}
      />
    </section>
  );
}

const toggle = () =>
  screen.getByRole("button", {
    name: t(members.suspendFor, { name: "Mira K." }),
  });
const confirmButton = () =>
  screen.getByRole("button", { name: members.suspend });

afterEach(() => {
  act(() => dismissToast());
});

describe("MemberStatusControl — suspend", () => {
  test("the toggle opens the confirm step, which names the person and focuses the confirm button", async () => {
    render(<AccessCard start="suspend" />);

    await userEvent.click(toggle());

    expect(
      screen.getByText(t(members.suspendConfirm, { name: "Mira K." })),
    ).toBeVisible();
    for (const line of [
      members.suspendSignOut,
      members.suspendLoans,
      members.suspendItems,
      members.suspendOut,
      members.suspendRestore,
    ]) {
      expect(screen.getByText(line)).toBeVisible();
    }
    expect(screen.queryByText(members.suspendInvitations)).toBeNull();
    await vi.waitFor(() => expect(confirmButton()).toHaveFocus());
    expect(confirmButton()).toHaveAccessibleDescription(
      expect.stringContaining(members.suspendSignOut),
    );
    expect(suspendMember).not.toHaveBeenCalled();
  });

  test("an organizer target also lists that their open invitations stop working", async () => {
    render(<AccessCard start="suspend" isOrganizer />);
    await userEvent.click(toggle());
    expect(screen.getByText(members.suspendInvitations)).toBeVisible();
  });

  test("Keep active closes the step and returns focus to the toggle", async () => {
    render(<AccessCard start="suspend" />);
    await userEvent.click(toggle());

    await userEvent.click(
      screen.getByRole("button", { name: members.keepActive }),
    );

    await vi.waitFor(() => expect(toggle()).toHaveFocus());
    expect(screen.queryByText(members.suspendSignOut)).toBeNull();
    expect(suspendMember).not.toHaveBeenCalled();
  });

  // The control remounts in the same commit as the action's state, as with refresh().
  test("a suspension sends the id, toasts and focuses the Access heading before Reinstate shows", async () => {
    vi.mocked(suspendMember).mockImplementation(async () => {
      swapStatus();
      return { flash: "memberSuspended" };
    });
    render(<AccessCard start="suspend" />);
    await userEvent.click(toggle());

    await userEvent.click(confirmButton());

    expect(
      await screen.findByRole("button", { name: members.reinstate }),
    ).toBeVisible();
    expect(vi.mocked(suspendMember).mock.calls[0][1].get("id")).toBe("m-1");
    expect(getActiveToast()?.key).toBe("memberSuspended");
    expect(
      screen.getByRole("heading", { name: members.accessHeading }),
    ).toHaveFocus();
  });

  test.each([
    ["stale", errors.stale],
    ["lastOrganizer", members.lastOrganizer],
    ["self", members.statusSelf],
  ] as const)(
    "a %s refusal replaces the control with its focused notice, no toast",
    async (formError, message) => {
      vi.mocked(suspendMember).mockResolvedValue({ formError });
      render(<AccessCard start="suspend" />);
      await userEvent.click(toggle());

      await userEvent.click(confirmButton());

      const notice = await screen.findByText(message);
      await vi.waitFor(() =>
        expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(getActiveToast()).toBeNull();
    },
  );

  test("an unexpected failure keeps the confirm step for a retry", async () => {
    vi.mocked(suspendMember).mockResolvedValue({ formError: "unexpected" });
    render(<AccessCard start="suspend" />);
    await userEvent.click(toggle());

    await userEvent.click(confirmButton());

    const notice = await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
    );
    expect(confirmButton()).toBeVisible();
  });
});

describe("MemberStatusControl — reinstate", () => {
  test("is one primary button that sends the id, toasts and focuses the heading", async () => {
    vi.mocked(reinstateMember).mockImplementation(async () => {
      swapStatus();
      return { flash: "memberReinstated" };
    });
    render(<AccessCard start="reinstate" />);

    await userEvent.click(
      screen.getByRole("button", { name: members.reinstate }),
    );

    expect(await screen.findByRole("button", { name: /./ })).toBe(toggle());
    expect(vi.mocked(reinstateMember).mock.calls[0][1].get("id")).toBe("m-1");
    expect(getActiveToast()?.key).toBe("memberReinstated");
    expect(
      screen.getByRole("heading", { name: members.accessHeading }),
    ).toHaveFocus();
    expect(suspendMember).not.toHaveBeenCalled();
  });

  test("a stale refusal shows the focused notice, no toast", async () => {
    vi.mocked(reinstateMember).mockResolvedValue({ formError: "stale" });
    render(<AccessCard start="reinstate" />);

    await userEvent.click(
      screen.getByRole("button", { name: members.reinstate }),
    );

    const notice = await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(getActiveToast()).toBeNull();
  });
});
