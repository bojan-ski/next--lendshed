import { fireEvent, render, screen } from "@testing-library/react";
import { strings } from "@/strings";
import type { ItemCardDTO } from "@/types/item";
import ItemCard from "./ItemCard";

const item: ItemCardDTO = {
  id: "item-1",
  title: "Cordless drill",
  categoryId: "cat-1",
  categoryName: "Tools",
  ownerName: "Marko J.",
  ownerArea: "north end",
  photo: null,
  freeToday: false,
};

describe("ItemCard", () => {
  test("the whole card links to the item page", () => {
    render(<ItemCard item={item} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/items/item-1");
  });

  test("meta line with an area", () => {
    render(<ItemCard item={item} />);
    expect(screen.getByText("Marko J. · north end")).toBeInTheDocument();
  });

  test("meta line without an area is the name alone", () => {
    render(<ItemCard item={{ ...item, ownerArea: null }} />);
    expect(screen.getByText("Marko J.")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  test("Free today only when true", () => {
    const { rerender } = render(<ItemCard item={item} />);
    expect(
      screen.queryByText(strings.status.freeToday),
    ).not.toBeInTheDocument();
    rerender(<ItemCard item={{ ...item, freeToday: true }} />);
    expect(screen.getByText(strings.status.freeToday)).toBeInTheDocument();
  });

  test("shows the category on its own line", () => {
    render(<ItemCard item={item} />);
    expect(screen.getByText("Tools")).toHaveClass("truncate");
  });

  test("a photo renders as a decorative square image", () => {
    const { container } = render(
      <ItemCard
        item={{
          ...item,
          photo: { url: "/uploads/items/a.webp", width: 1200, height: 900 },
        }}
      />,
    );
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveClass("aspect-square", "object-cover");
    expect(screen.queryByTestId("photo-placeholder")).not.toBeInTheDocument();
  });

  test("no photo, or a failed load, shows the placeholder with the title", () => {
    const { container, rerender } = render(<ItemCard item={item} />);
    expect(screen.getByTestId("photo-placeholder")).toHaveClass(
      "aspect-square",
    );

    rerender(
      <ItemCard
        item={{
          ...item,
          photo: { url: "/uploads/items/a.webp", width: 1200, height: 900 },
        }}
      />,
    );
    fireEvent.error(container.querySelector("img")!);

    expect(screen.getByTestId("photo-placeholder")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: item.title }),
    ).toBeInTheDocument();
  });

  test("the title is an h2 by default and an h3 when asked", () => {
    const { rerender } = render(<ItemCard item={item} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      item.title,
    );
    rerender(<ItemCard item={item} headingLevel="h3" />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      item.title,
    );
  });
});
