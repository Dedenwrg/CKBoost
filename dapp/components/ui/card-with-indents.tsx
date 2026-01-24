import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CardWithIndentsProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const CardWithIndents = React.forwardRef<
  HTMLDivElement,
  CardWithIndentsProps
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative w-full">
      {/* Four corner square indents - aligned with card border corners */}
      {/* Top-left */}
      <div className="absolute top-0 left-0 w-4 h-4 bg-white dark:bg-black z-20 border-b-1 border-r-1 shadow-none" />
      {/* Top-right: left border (inset) */}
      <div
        className="absolute top-0 right-0 w-4 h-4 bg-white dark:bg-black z-20 border-b-1 shadow-none"
        style={{
          borderLeft: "3px solid #535353",
        }}
      />
      {/* Bottom-right: top and left border (inset) */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 bg-white dark:bg-black z-20 shadow-none"
        style={{
          borderTop: "3px solid #535353",
          borderLeft: "3px solid #535353",
        }}
      />
      {/* Bottom-left: top border (inset) */}
      <div
        className="absolute bottom-0 left-0 w-4 h-4 bg-white dark:bg-black z-20 border-r-1 shadow-none"
        style={{
          borderTop: "3px solid #535353",
        }}
      />
      <Card
        ref={ref}
        className={cn(
          "overflow-hidden flex flex-col h-full w-full bg-[#F2FAF4] dark:bg-[#1b1b1b] border border-[#535353] dark:border-[#535353] border-r-3 border-b-3 border-[#535353] dark:border-[#535353] border-t-1 border-l-1 relative z-10 shadow-none",
          className,
        )}
        style={{
          borderRadius: "8px",
        }}
        {...props}
      >
        {children}
      </Card>
    </div>
  );
});

CardWithIndents.displayName = "CardWithIndents";
