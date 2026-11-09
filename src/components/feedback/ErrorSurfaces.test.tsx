import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppError from "@/app/(app)/error";
import AppNotFound from "@/app/(app)/not-found";
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      strings.errors.somethingWentWrong,
    );
    expect(screen.queryByText(/db password leaked/)).not.toBeInTheDocument();
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
