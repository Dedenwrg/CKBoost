import React from "react"

/**
 * Pixel art style CKBoost logo component
 * Uses the exported image from Figma (node-id: 44:620)
 */
export function PixelLogo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <img
        src="/assets/branding/CKBoost Pixel Art Logo - Hero.svg"
        alt="CKBoost Pixel Art Logo"
        className="w-full h-auto"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  )
}
