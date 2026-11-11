import Image from "next/image";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import type { PhotoDTO } from "@/types/item";

type ItemPhotoPreviewProps = {
  photo: PhotoDTO | null;
  // The prepared file's object URL while it is being saved.
  pendingUrl: string | null;
  alt: string;
};

export default function ItemPhotoPreview({
  photo,
  pendingUrl,
  alt,
}: ItemPhotoPreviewProps) {
  return (
    <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-card sm:w-48">
      {pendingUrl ? (
        <Image
          src={pendingUrl}
          alt={alt}
          fill
          unoptimized
          className="object-cover"
        />
      ) : photo ? (
        <PhotoImage
          photo={photo}
          alt={alt}
          className="size-full object-cover"
        />
      ) : (
        <PhotoPlaceholder iconSize={32} className="size-full" />
      )}
    </div>
  );
}
