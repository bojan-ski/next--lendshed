"use client";

import { useState, type ComponentProps } from "react";
import { controlClasses } from "@/components/ui/control-styles";
import { Icon } from "@/components/ui/icons";
import { fields } from "@/strings/fields";

type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

export default function PasswordInput({
  className,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={controlClasses("h-13 pr-14", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? fields.hidePassword : fields.showPassword}
        className="absolute inset-y-0 right-0 inline-flex w-13 items-center justify-center rounded-control text-ink"
      >
        <Icon name={visible ? "eye-off" : "eye"} aria-hidden />
      </button>
    </div>
  );
}
