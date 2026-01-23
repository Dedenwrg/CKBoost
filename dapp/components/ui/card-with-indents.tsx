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
      {/* Top-left: no border */}
      <div className="absolute top-0 left-0 w-4 h-4 bg-white dark:bg-black z-20" />
      {/* Top-right: left border (inset) */}
      <div
        className="absolute top-0 right-0 w-4 h-4 bg-white dark:bg-black z-20"
        style={{
          borderLeft: "3px solid #535353",
        }}
      />
      {/* Bottom-right: top and left border (inset) */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 bg-white dark:bg-black z-20"
        style={{
          borderTop: "3px solid #535353",
          borderLeft: "3px solid #535353",
        }}
      />
      {/* Bottom-left: top border (inset) */}
      <div
        className="absolute bottom-0 left-0 w-4 h-4 bg-white dark:bg-black z-20"
        style={{
          borderTop: "3px solid #535353",
        }}
      />
      <Card
        ref={ref}
        className={cn(
          "bg-[#1b1b1b] dark:bg-[#1b1b1b] border-[#535353] dark:border-[#535353] relative border-r-3 border-b-3 border-t-0 border-l-0 z-10",
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
