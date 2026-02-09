"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Star, Check, X, Clock, CheckCircle, XCircle, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";

interface Review {
  id: string;
  rating: number | null;
  comment: string | null;
  status: string;
  createdAt: string;
  appointmentId: string | null;
  clientName: string;
  clientEmail: string | null;
  employeeName: string;
  serviceName: string;
  appointmentDate: string | null;
}

export default function ReviewModerationPage() {
  const { data: session, isPending } = useSession();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [moderatingId, setModeratingId] = useState<string | null>(null);

  const fetchReviews = useCallback(async (status: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/reviews?status=${status}`);
      const data = await res.json();
      if (data.success) {
        setReviews(data.data);
      } else {
        console.error("[Reviews Page] Error:", data.error);
        if (res.status === 403) {
          toast.error("Brak dostepu - musisz byc wlascicielem salonu");
        }
      }
    } catch (error) {
      console.error("[Reviews Page] Fetch error:", error);
      toast.error("Nie udalo sie pobrac opinii");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchReviews(statusFilter);
    }
  }, [session, statusFilter, fetchReviews]);

  const handleModerate = async (reviewId: string, action: "approve" | "reject") => {
    try {
      setModeratingId(reviewId);
      const res = await fetch(`/api/reviews/${reviewId}/moderate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        // Remove from list since status changed
        setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      } else {
        toast.error(data.error || "Nie udalo sie zmoderować opinii");
      }
    } catch (error) {
      console.error("[Reviews Page] Moderate error:", error);
      toast.error("Wystapil blad");
    } finally {
      setModeratingId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderStars = (rating: number | null) => {
    if (rating === null) return <span className="text-muted-foreground text-sm">Brak oceny</span>;
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`w-4 h-4 ${i <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
          />
        ))}
        <span className="ml-1 text-sm font-medium">{rating}/5</span>
      </div>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            <Clock className="w-3 h-3 mr-1" />
            Oczekuje
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
            <CheckCircle className="w-3 h-3 mr-1" />
            Zatwierdzona
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Odrzucona
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6 text-center">
        <p className="text-muted-foreground">Zaloguj sie, aby zarzadzac opiniami.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Powrot
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Moderacja opinii</h1>
          <p className="text-muted-foreground text-sm">
            Przegladaj i zatwierdzaj opinie klientow
          </p>
        </div>
      </div>

      <Tabs
        defaultValue="pending"
        onValueChange={(val) => setStatusFilter(val)}
      >
        <TabsList>
          <TabsTrigger value="pending">
            <Clock className="w-4 h-4 mr-1" />
            Oczekujace
          </TabsTrigger>
          <TabsTrigger value="approved">
            <CheckCircle className="w-4 h-4 mr-1" />
            Zatwierdzone
          </TabsTrigger>
          <TabsTrigger value="rejected">
            <XCircle className="w-4 h-4 mr-1" />
            Odrzucone
          </TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter}>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="text-muted-foreground">Ladowanie opinii...</div>
            </div>
          ) : reviews.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <MessageSquareWarning className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-1">Brak opinii</h3>
              <p className="text-muted-foreground text-sm">
                {statusFilter === "pending"
                  ? "Nie ma opinii oczekujacych na moderacje."
                  : statusFilter === "approved"
                    ? "Nie ma jeszcze zatwierdzonych opinii."
                    : "Nie ma odrzuconych opinii."}
              </p>
            </div>
          ) : (
            <div className="space-y-4 mt-4">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="border border-border rounded-lg p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{review.clientName}</span>
                        {getStatusBadge(review.status)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {review.serviceName} &middot; {review.employeeName}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <div>{formatDate(review.createdAt)}</div>
                      {review.appointmentDate && (
                        <div className="text-xs mt-0.5">
                          Wizyta: {formatDate(review.appointmentDate)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mb-3">{renderStars(review.rating)}</div>

                  {review.comment && (
                    <div className="bg-muted/50 rounded-md p-3 mb-3">
                      <p className="text-sm whitespace-pre-wrap">{review.comment}</p>
                    </div>
                  )}

                  {review.status === "pending" && (
                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                      <Button
                        size="sm"
                        onClick={() => handleModerate(review.id, "approve")}
                        disabled={moderatingId === review.id}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Zatwierdz
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleModerate(review.id, "reject")}
                        disabled={moderatingId === review.id}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Odrzuc
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
