import { cn } from "@/lib/text/cn";
import { Icon } from "@/components/ui/icons";

type PhotoPlaceholderProps = {
  iconSize?: number;
  className?: string;
};

export default function PhotoPlaceholder({
  iconSize = 20,
  className,
}: PhotoPlaceholderProps) {
  return (
    <div
      data-testid="photo-placeholder"
      className={cn(
        "flex items-center justify-center bg-neutral-soft text-muted",
        className,
      )}
    >
      <Icon name="image" size={iconSize} aria-hidden />
    </div>
  );
}
