import { render, screen } from "@testing-library/react";
import { strings } from "@/strings";
import type { ItemCardDTO } from "@/types/item";
import ItemCard from "./ItemCard";

const item: ItemCardDTO = {
  id: "item-1",
  title: "Cordless drill",
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

  test("never shows the category", () => {
    render(<ItemCard item={item} />);
    expect(screen.queryByText("Tools")).not.toBeInTheDocument();
  });

  test("shows the placeholder, even when a photo is given (until spec 11)", () => {
    render(
      <ItemCard
        item={{
          ...item,
          photo: { url: "https://blob.test/a.webp", width: 640, height: 640 },
        }}
      />,
    );
    expect(screen.getByTestId("photo-placeholder")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
