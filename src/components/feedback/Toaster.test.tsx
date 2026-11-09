import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname } from "next/navigation";
import { dismissToast, showToast } from "@/lib/toast";
import type { FlashKey } from "@/strings";
import { toast as toastStrings } from "@/strings/toast";
import Toaster from "./Toaster";

vi.mock("@/strings/flash", () => ({ flash: { itemSaved: "Item saved." } }));
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
