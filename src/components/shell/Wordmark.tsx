import Image from "next/image";
import Link from "next/link";
import { publicEnv } from "@/lib/env/public";

export default function Wordmark() {
  return (
    <Link href="/" className="inline-flex min-h-11 items-center">
      <Image
        src="/wordmark.svg"
        alt={publicEnv.NEXT_PUBLIC_APP_NAME}
        width={170}
        height={28}
        unoptimized
        loading="eager"
      />
    </Link>
  );
}
