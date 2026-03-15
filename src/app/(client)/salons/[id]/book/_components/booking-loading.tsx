"use client";

export function BookingLoading() {
  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    </div>
  );
}
