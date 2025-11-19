"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { cn } from "@/lib/utils";

interface CampaignCoverImageProps {
  src?: string | null;
  alt: string;
  isLoading?: boolean;
  fallbackSrc?: string;
  className?: string;
  children?: ReactNode;
}

const RATIO = 32 / 15;

export function CampaignCoverImage({
  src,
  alt,
  isLoading = false,
  fallbackSrc = "/placeholder.svg",
  className,
  children,
}: CampaignCoverImageProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const displaySource = !hasError && src ? src : fallbackSrc;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-muted/30",
        className
      )}
    >
      <AspectRatio ratio={RATIO}>
        <div className="relative h-full w-full">
          {isLoading ? (
            <div className="absolute inset-0 animate-pulse bg-muted/40" />
          ) : (
            <Image
              src={displaySource}
              alt={alt}
              fill
              sizes="(min-width: 1024px) 720px, 100vw"
              className="object-cover"
              onError={() => setHasError(true)}
            />
          )}
        </div>
      </AspectRatio>
      {children}
    </div>
  );
}
