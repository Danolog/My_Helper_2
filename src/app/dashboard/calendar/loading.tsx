import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header: date nav + view toggle */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20 rounded-lg" />
          <Skeleton className="h-9 w-20 rounded-lg" />
        </div>
      </div>

      {/* Employee filter */}
      <Skeleton className="h-9 w-48 rounded-lg mb-6" />

      {/* Time grid skeleton */}
      <div className="border rounded-lg overflow-hidden">
        {/* Hour rows */}
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex border-b last:border-b-0">
            <Skeleton className="h-16 w-16 shrink-0 rounded-none" />
            <div className="flex-1 p-2">
              {i % 3 === 0 && <Skeleton className="h-10 w-3/4 rounded-md" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
