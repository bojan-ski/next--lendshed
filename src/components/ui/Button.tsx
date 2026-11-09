"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import {
  buttonClasses,
  type ButtonVariant,
} from "@/components/ui/button-styles";

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  pending?: boolean;
};

export default function Button({
  variant = "primary",
  pending,
  type = "button",
  disabled,
  className,
  ...props
}: ButtonProps) {
  const form = useFormStatus();
  const busy = pending ?? (type === "submit" && form.pending);

  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClasses(variant, className)}
      {...props}
    />
  );
}
