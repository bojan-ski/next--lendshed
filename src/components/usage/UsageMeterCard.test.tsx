import { render, screen } from "@testing-library/react";
import { t } from "@/lib/text/interpolate";
import { usage } from "@/strings/usage";
import UsageMeterCard from "./UsageMeterCard";

const base = {
  id: "usage-uploads",
  title: usage.uploadsTitle,
  usedText: "64",
  limitText: "1,500",
  percent: 4,
  used: 64,
  max: 1500,
  warn: false,
  warnText: "Warning line",
  fill: "primary" as const,
};

describe("UsageMeterCard", () => {
  test("a meter named by its heading, with the range and the true reading", () => {
    render(<UsageMeterCard {...base} />);

    const meter = screen.getByRole("meter", { name: usage.uploadsTitle });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "1500");
    expect(meter).toHaveAttribute("aria-valuenow", "64");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      t(usage.valueText, { used: "64", limit: "1,500", percent: 4 }),
    );
    expect(
      screen.getByRole("heading", { level: 2, name: usage.uploadsTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t(usage.usedOf, { used: "64", limit: "1,500" }), {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  test("past the limit: valuenow is clamped, valuetext keeps the real number", () => {
    render(
      <UsageMeterCard
        {...base}
        usedText="1,600"
        used={1600}
        percent={106}
        warn
      />,
    );

    const meter = screen.getByRole("meter", { name: usage.uploadsTitle });
    expect(meter).toHaveAttribute("aria-valuenow", "1500");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      t(usage.valueText, { used: "1,600", limit: "1,500", percent: 106 }),
    );
  });

  test("the warning line shows only when warn is true", () => {
    const { rerender } = render(<UsageMeterCard {...base} />);
    expect(screen.queryByText(base.warnText)).not.toBeInTheDocument();

    rerender(<UsageMeterCard {...base} warn />);
    expect(screen.getByText(base.warnText)).toBeInTheDocument();
  });
});
