import { cn } from "@/lib/text/cn";
import { hueStyle, type Hue } from "@/lib/text/hue";
import { Icon } from "@/components/ui/icons";

type PhotoPlaceholderProps = {
  iconSize?: number;
  className?: string;
  // The item's category hue: stripes in its colours. Without one, neutral.
  hue?: Hue;
};

export default function PhotoPlaceholder({
  iconSize = 20,
  className,
  hue,
}: PhotoPlaceholderProps) {
  return (
    <div
      data-testid="photo-placeholder"
      style={hue === undefined ? undefined : hueStyle(hue)}
      className={cn(
        "flex items-center justify-center",
        hue === undefined
          ? "bg-neutral-soft text-muted"
          : "photo-stripes text-hue-ink",
        className,
      )}
    >
      <Icon name="image" size={iconSize} aria-hidden />
    </div>
  );
}
