import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewsLoading() {
  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Skeleton className="h-9 w-20 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>

      {/* Tabs */}
      <Skeleton className="h-10 w-80 rounded-lg mb-4" />

      {/* Review cards */}
      <div className="space-y-4 mt-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border rounded-lg p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }, (_, j) => (
                <Skeleton key={j} className="h-4 w-4 rounded" />
              ))}
            </div>
            <Skeleton className="h-16 w-full rounded-md" />
            <div className="flex items-center gap-2 pt-2 border-t">
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
