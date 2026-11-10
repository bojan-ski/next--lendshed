import { render, screen } from "@testing-library/react";
import Notice from "./Notice";

describe("Notice", () => {
  test("an error notice is an alert by default", () => {
    render(<Notice tone="error">Those dates were just taken.</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Those dates were just taken.",
    );
  });

  test("an info notice is never an alert", () => {
    render(<Notice tone="info">Uploads open again on Sat 14 Nov.</Notice>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("alert={false} drops the role where focus does the announcing", () => {
    render(
      <Notice tone="error" alert={false}>
        Something went wrong
      </Notice>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
