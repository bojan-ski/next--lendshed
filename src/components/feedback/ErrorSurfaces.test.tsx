import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppError from "@/app/(app)/error";
import AppNotFound, {
  metadata as AppNotFoundMetadata,
} from "@/app/(app)/not-found";
import PublicError from "@/app/(public)/error";
import { strings } from "@/strings";

describe.each([
  ["(app)/error", AppError],
  ["(public)/error", PublicError],
])("%s", (_name, ErrorBoundary) => {
  test("shows the errors-strings notice, never the error message", () => {
    render(
      <ErrorBoundary
        error={new Error("db password leaked")}
        retry={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      strings.errors.somethingWentWrong,
    );
    expect(screen.queryByText(/db password leaked/)).not.toBeInTheDocument();
  });

  test("the message is the page's one h1 and takes focus", () => {
    render(<ErrorBoundary error={new Error("boom")} retry={() => {}} />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(strings.errors.somethingWentWrong);
    expect(headings[0]).toHaveFocus();
    // Focus announces it; an alert region as well would read it twice.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("Try again calls retry()", async () => {
    const retry = vi.fn();
    render(<ErrorBoundary error={new Error("boom")} retry={retry} />);
    await userEvent.click(
      screen.getByRole("button", { name: strings.errors.tryAgain }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });
});

test("(app)/not-found has the not-found page title", () => {
  expect(AppNotFoundMetadata.title).toBe(strings.errors.notFoundTitle);
});

describe("(app)/not-found", () => {
  test("copy comes from the errors strings, with a way out to /", () => {
    render(<AppNotFound />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      strings.errors.notFoundTitle,
    );
    expect(screen.getByText(strings.errors.notFoundBody)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: strings.errors.notFoundAction }),
    ).toHaveAttribute("href", "/");
  });
});
