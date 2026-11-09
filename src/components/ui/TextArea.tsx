import type { ComponentProps } from "react";
import { controlClasses } from "@/components/ui/control-styles";

export default function TextArea({
  rows = 4,
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={controlClasses("py-2", className)}
      {...props}
    />
  );
}
