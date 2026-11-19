import type { ComponentProps } from "react";
import { controlClasses } from "@/components/ui/control-styles";

export default function TextInput({
  type = "text",
  className,
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={controlClasses("h-13", className)}
      {...props}
    />
  );
}
