import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { NAME_MAX } from "@/lib/schemas/limits";
import { members } from "@/strings/members";
import MemberSearchForm from "./MemberSearchForm";

// next/form needs the app router; a plain GET form stands in.
vi.mock("next/form", () => ({
  default: (props: ComponentProps<"form">) => <form method="get" {...props} />,
}));

const field = () => screen.getByLabelText(members.searchLabel);

describe("MemberSearchForm", () => {
  test("a search landmark that GETs /admin/members with the field named q", () => {
    render(<MemberSearchForm q="" />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/admin/members");
    expect(field()).toHaveAttribute("name", "q");
    expect(field()).toHaveAttribute("type", "search");
    expect(field()).toHaveAttribute("maxLength", String(NAME_MAX));
    expect(
      screen.getByRole("button", { name: members.search }),
    ).toHaveAttribute("type", "submit");
  });

  test("with no search: an empty field and no way to clear it", () => {
    render(<MemberSearchForm q="" />);
    expect(field()).toHaveValue("");
    expect(
      screen.queryByRole("link", { name: members.showEveryone }),
    ).toBeNull();
  });

  test("with a search: the field holds it and Show everyone clears it", () => {
    render(<MemberSearchForm q="ana" />);
    expect(field()).toHaveValue("ana");
    expect(
      screen.getByRole("link", { name: members.showEveryone }),
    ).toHaveAttribute("href", "/admin/members");
  });
});
