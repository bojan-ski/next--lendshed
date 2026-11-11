import { fireEvent, render, screen } from "@testing-library/react";
import PhotoImage from "./PhotoImage";

const photo = { url: "/uploads/items/a.webp", width: 1200, height: 900 };

describe("PhotoImage", () => {
  test("renders the photo at its own size with the given alt", () => {
    render(
      <PhotoImage photo={photo} alt="Photo of Ladder" className="size-12" />,
    );

    const image = screen.getByRole("img", { name: "Photo of Ladder" });
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "900");
    expect(image).toHaveClass("size-12");
  });

  test("a failed load shows the placeholder in the same box", () => {
    render(
      <PhotoImage photo={photo} alt="Photo of Ladder" className="size-12" />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Photo of Ladder" }));

    expect(screen.queryByRole("img", { name: "Photo of Ladder" })).toBeNull();
    expect(screen.getByTestId("photo-placeholder")).toHaveClass("size-12");
  });

  test("a new photo after a failure is tried again", () => {
    const { rerender } = render(<PhotoImage photo={photo} alt="Ladder" />);
    fireEvent.error(screen.getByRole("img", { name: "Ladder" }));

    rerender(
      <PhotoImage
        photo={{ ...photo, url: "/uploads/items/b.webp" }}
        alt="Ladder"
      />,
    );

    expect(screen.getByRole("img", { name: "Ladder" })).toBeInTheDocument();
    expect(screen.queryByTestId("photo-placeholder")).toBeNull();
  });

  test("a decorative thumbnail (alt='') is hidden from the accessibility tree", () => {
    const { container } = render(<PhotoImage photo={photo} alt="" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).toBeNull();
  });
});
