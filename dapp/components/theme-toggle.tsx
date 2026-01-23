"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  if (!mounted) {
    return (
      <div className="relative inline-flex h-10 w-20 items-center rounded-full transition-colors bg-gray-400 dark:bg-[#515151]">
        <div className="absolute left-1 flex h-8 w-8 items-center justify-center rounded-full transition-transform bg-[#FF4D00] dark:bg-[#3300FF]">
          <Moon className="h-4 w-4 text-white" strokeWidth={2} />
        </div>
        <Sun className="absolute left-2 h-4 w-4 text-white opacity-50" strokeWidth={2} />
        <Moon className="absolute right-2 h-4 w-4 text-white opacity-50" strokeWidth={2} />
      </div>
    )
  }

  const isDark = theme === "dark"

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "cursor-pointer bg-gray-400 dark:bg-[#515151]"
      )}
      aria-label="Toggle theme"
    >
      {/* Sun icon on the left - always visible but with opacity */}
      <Sun
        className={cn(
          "absolute left-2.5 h-4 w-4 text-white transition-opacity z-0",
          isDark ? "opacity-50" : "opacity-100"
        )}
        strokeWidth={2}
        fill="none"
      />
      
      {/* Moon icon on the right - always visible but with opacity */}
      <Moon
        className={cn(
          "absolute right-2.5 h-4 w-4 text-white transition-opacity z-0",
          isDark ? "opacity-100" : "opacity-50"
        )}
        strokeWidth={2}
        fill="none"
      />
      
      {/* Sliding button with icon */}
      <div
        className={cn(
          "absolute flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-300 ease-in-out z-10 shadow-md",
          isDark ? "translate-x-[2.75rem]" : "translate-x-1",
          "bg-[#FF4D00] dark:bg-[#3300FF]"
        )}
      >
        {isDark ? (
          <Moon className="h-4 w-4 text-white" strokeWidth={2} fill="none" />
        ) : (
          <Sun className="h-4 w-4 text-white" strokeWidth={2} fill="none" />
        )}
      </div>
    </button>
  )
}