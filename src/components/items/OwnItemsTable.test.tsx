import { render, screen, within } from "@testing-library/react";
import { t } from "@/lib/text/interpolate";
import { items } from "@/strings/items";
import type { OwnItemRowDTO } from "@/types/item";
import OwnItemsTable from "./OwnItemsTable";

const row = (
  id: string,
  title: string,
  status: OwnItemRowDTO["status"],
): OwnItemRowDTO => ({
  id,
  title,
  status,
  photo: null,
  now: { kind: status === "retired" ? "retired" : "idle", personName: null },
});

// spec 27 walkthrough, W-01: an owner sees a listed item as neighbours do.
describe("OwnItemsTable", () => {
  test("a listed item's title links to its item page; hidden and retired titles don't", () => {
    render(
      <OwnItemsTable
        rows={[
          row("i-listed", "Orbital sander", "listed"),
          row("i-hidden", "Wheelbarrow", "hidden"),
          row("i-retired", "Tile cutter", "retired"),
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Orbital sander" }),
    ).toHaveAttribute("href", "/items/i-listed");
    expect(
      screen.queryByRole("link", { name: "Wheelbarrow" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Tile cutter" }),
    ).not.toBeInTheDocument();
  });

  test("every row keeps its Edit or View link to the edit page", () => {
    render(
      <OwnItemsTable
        rows={[
          row("i-listed", "Orbital sander", "listed"),
          row("i-retired", "Tile cutter", "retired"),
        ]}
      />,
    );

    const [, listedRow, retiredRow] = screen.getAllByRole("row");
    expect(
      within(listedRow).getByRole("link", {
        name: t(items.editFor, { title: "Orbital sander" }),
      }),
    ).toHaveAttribute("href", "/my/items/i-listed/edit");
    expect(
      within(retiredRow).getByRole("link", {
        name: t(items.viewFor, { title: "Tile cutter" }),
      }),
    ).toHaveAttribute("href", "/my/items/i-retired/edit");
  });
});
