import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  variant?: "default" | "outline" | "ghost";
  "data-testid"?: string;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const ActionIcon = action?.icon;

  return (
    <Card className={className}>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
          <Icon className="w-8 h-8 text-primary" />
        </div>
        <h3 className="font-[family-name:var(--font-playfair)] text-xl font-semibold mb-2">
          {title}
        </h3>
        <p className="text-muted-foreground text-sm max-w-sm">
          {description}
        </p>
        {action && (
          <div className="mt-6">
            {action.href ? (
              <Button
                asChild
                variant={action.variant ?? "default"}
                data-testid={action["data-testid"]}
              >
                <Link href={action.href}>
                  {ActionIcon && <ActionIcon className="h-4 w-4 mr-2" />}
                  {action.label}
                </Link>
              </Button>
            ) : (
              <Button
                onClick={action.onClick}
                variant={action.variant ?? "default"}
                data-testid={action["data-testid"]}
              >
                {ActionIcon && <ActionIcon className="h-4 w-4 mr-2" />}
                {action.label}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
