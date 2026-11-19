"use client";

import Image from "next/image";
import { useState } from "react";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import type { Hue } from "@/lib/text/hue";
import type { PhotoDTO } from "@/types/item";

type PhotoImageProps = {
  photo: PhotoDTO;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  unoptimized?: boolean;
  hue?: Hue;
};

// The photo's own size, so next/image only ever asks for the one 640 variant.
// A failed load shows the placeholder in the same box (or `fallbackClassName`,
// for an image that sizes itself); a new photo retries.
export default function PhotoImage({
  photo,
  alt,
  className,
  fallbackClassName,
  unoptimized,
  hue,
}: PhotoImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (failedUrl === photo.url) {
    return (
      <PhotoPlaceholder className={fallbackClassName ?? className} hue={hue} />
    );
  }
  return (
    <Image
      src={photo.url}
      width={photo.width}
      height={photo.height}
      alt={alt}
      unoptimized={unoptimized}
      onError={() => setFailedUrl(photo.url)}
      className={className}
    />
  );
}
