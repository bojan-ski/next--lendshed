import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname } from "next/navigation";
import { publicEnv } from "@/lib/env/public";
import { dismissToast, showToast } from "@/lib/feedback/toast";
import type { FlashKey } from "@/strings";
import { toast as toastStrings } from "@/strings/toast";
import Toaster from "./Toaster";

vi.mock("@/strings/flash", () => ({
  flash: { itemSaved: "Item saved.", joined: "Welcome to {appName}." },
}));
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/") }));

const key = "itemSaved" as FlashKey;

function setFlashCookie(value: string) {
  document.cookie = `flash=${value}; path=/`;
}

const hasFlashCookie = () =>
  document.cookie.split("; ").some((c) => c.startsWith("flash="));

afterEach(() => {
  act(() => dismissToast());
  document.cookie = "flash=; Max-Age=0; path=/";
  vi.useRealTimers();
});

describe("Toaster", () => {
  test("keeps an empty live region in the DOM", () => {
    render(<Toaster />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
  });

  test("shows a known flash key's string and deletes the cookie", () => {
    setFlashCookie("itemSaved");
    render(<Toaster />);
    expect(screen.getByRole("status")).toHaveTextContent("Item saved.");
    expect(hasFlashCookie()).toBe(false);
  });

  test("fills {appName} in a flash string from the public env", () => {
    render(<Toaster />);
    act(() => showToast("joined" as FlashKey));
    expect(
      screen.getByText(`Welcome to ${publicEnv.NEXT_PUBLIC_APP_NAME}.`),
    ).toBeInTheDocument();
  });

  test("an unknown key shows nothing and still deletes the cookie", () => {
    setFlashCookie("notAKey");
    render(<Toaster />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(hasFlashCookie()).toBe(false);
  });

  test("an empty value shows nothing and still deletes the cookie", () => {
    setFlashCookie("");
    render(<Toaster />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(hasFlashCookie()).toBe(false);
  });

  test("checks the cookie again after a navigation", () => {
    const { rerender } = render(<Toaster />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    setFlashCookie("itemSaved");
    vi.mocked(usePathname).mockReturnValue("/my/items");
    rerender(<Toaster />);
    expect(screen.getByRole("status")).toHaveTextContent("Item saved.");
  });

  test("auto-dismisses after 5 s", () => {
    vi.useFakeTimers();
    setFlashCookie("itemSaved");
    render(<Toaster />);

    act(() => vi.advanceTimersByTime(4999));
    expect(screen.getByRole("status")).toHaveTextContent("Item saved.");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  // userEvent awaits a real tick between steps, so fake time also follows the
  // clock (shouldAdvanceTime); the margins absorb those few real milliseconds.
  test("hovering pauses the auto-dismiss; leaving restarts the full 5 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<Toaster />);
    act(() => showToast(key));
    const card = screen.getByText("Item saved.").parentElement!;

    await user.hover(card);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("status")).toHaveTextContent("Item saved.");

    await user.unhover(card);
    act(() => vi.advanceTimersByTime(4800));
    expect(screen.getByRole("status")).toHaveTextContent("Item saved.");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("focus inside the toast pauses the auto-dismiss", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<Toaster />);
    act(() => showToast(key));

    await user.tab();
    expect(
      screen.getByRole("button", { name: toastStrings.close }),
    ).toHaveFocus();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("status")).toHaveTextContent("Item saved.");

    await user.tab(); // focus leaves the toast
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("closing by keyboard returns focus to where it came from", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <Toaster />
      </>,
    );
    act(() => showToast(key));

    await user.tab();
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
    await user.tab();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });

  test("a malformed cookie value shows nothing, doesn't throw, and is deleted", () => {
    setFlashCookie("%E0%A4%A");
    render(<Toaster />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(hasFlashCookie()).toBe(false);
  });

  test("the close button dismisses at once", async () => {
    setFlashCookie("itemSaved");
    render(<Toaster />);
    await userEvent.click(
      screen.getByRole("button", { name: toastStrings.close }),
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("showToast(key) shows the toast through the mounted Toaster", () => {
    render(<Toaster />);
    act(() => showToast(key));
    expect(screen.getByRole("status")).toHaveTextContent("Item saved.");
  });

  test("a new toast replaces the current one and restarts the timer", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => showToast(key));
    act(() => vi.advanceTimersByTime(4000));
    act(() => showToast(key));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getAllByText("Item saved.")).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
