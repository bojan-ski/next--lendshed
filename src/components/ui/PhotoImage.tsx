"use client";

import Image from "next/image";
import { useState } from "react";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import type { PhotoDTO } from "@/types/item";

type PhotoImageProps = {
  photo: PhotoDTO;
  alt: string;
  className?: string;
  unoptimized?: boolean;
};

// The photo's own size, so next/image only ever asks for the one 640 variant.
// A failed load shows the placeholder in the same box; a new photo retries.
export default function PhotoImage({
  photo,
  alt,
  className,
  unoptimized,
}: PhotoImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (failedUrl === photo.url) return <PhotoPlaceholder className={className} />;
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
