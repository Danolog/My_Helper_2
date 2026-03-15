"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface BookingStep {
  label: string;
  completed: boolean;
  active: boolean;
}

interface BookingProgressBarProps {
  steps: BookingStep[];
}

export function BookingProgressBar({ steps }: BookingProgressBarProps) {
  return (
    <nav aria-label="Postep rezerwacji" className="mb-8">
      <ol className="flex items-center w-full">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li
              key={step.label}
              className={cn("flex items-center", !isLast && "flex-1")}
            >
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors shrink-0",
                    step.completed
                      ? "bg-primary text-primary-foreground"
                      : step.active
                        ? "bg-primary/20 text-primary border-2 border-primary"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {step.completed ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={cn(
                    "text-[11px] font-medium text-center leading-tight max-w-[72px]",
                    step.completed || step.active
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 mt-[-18px] transition-colors",
                    step.completed ? "bg-primary" : "bg-muted"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
