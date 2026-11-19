import { render, screen } from "@testing-library/react";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { publicEnv } from "@/lib/env/public";
import Copyright from "./Copyright";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/dates/request-today", () => ({
  requestToday: () => "2031-01-01",
}));

describe("Copyright", () => {
  test("reads the request first, then shows the community year and the app name", async () => {
    render(<>{(await Copyright()) as ReactNode}</>);
    expect(connection).toHaveBeenCalled();
    expect(
      screen.getByText(
        `© 2031 ${publicEnv.NEXT_PUBLIC_APP_NAME}. All rights reserved. code BPdevelopment`,
      ),
    ).toBeInTheDocument();
  });
});
