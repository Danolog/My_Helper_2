import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="container mx-auto p-6">
      {/* Back button */}
      <div className="flex items-center gap-4 mb-6">
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      {/* Push notification section */}
      <Skeleton className="h-20 w-full rounded-lg mb-6" />

      {/* Birthday section */}
      <Skeleton className="h-24 w-full rounded-lg mb-6" />

      {/* We miss you section */}
      <Skeleton className="h-24 w-full rounded-lg mb-6" />

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>

      {/* Notification rows */}
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="border rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-12 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-4 w-full" />
              </div>
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
