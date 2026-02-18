"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Star,
  Check,
  X,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquareWarning,
  Sparkles,
  Send,
  Loader2,
  Pencil,
  Trash2,
  MessageSquareReply,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";

interface Review {
  id: string;
  rating: number | null;
  comment: string | null;
  ownerResponse: string | null;
  ownerResponseAt: string | null;
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

  // AI Response state
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState<string>("");

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
        setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      } else {
        toast.error(data.error || "Nie udalo sie zmoderowac opinii");
      }
    } catch (error) {
      console.error("[Reviews Page] Moderate error:", error);
      toast.error("Wystapil blad");
    } finally {
      setModeratingId(null);
    }
  };

  const handleGenerateResponse = async (reviewId: string) => {
    try {
      setGeneratingId(reviewId);
      const res = await fetch("/api/ai/content/generate-review-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId }),
      });
      const data = await res.json();

      if (data.success) {
        setResponseText(data.response);
        toast.success("Odpowiedz AI wygenerowana");
      } else {
        if (data.code === "PLAN_UPGRADE_REQUIRED") {
          toast.error("Generowanie odpowiedzi AI wymaga Planu Pro");
        } else {
          toast.error(data.error || "Nie udalo sie wygenerowac odpowiedzi");
        }
      }
    } catch (error) {
      console.error("[Reviews Page] Generate response error:", error);
      toast.error("Wystapil blad podczas generowania odpowiedzi");
    } finally {
      setGeneratingId(null);
    }
  };

  const handleSaveResponse = async (reviewId: string) => {
    if (!responseText.trim()) {
      toast.error("Odpowiedz nie moze byc pusta");
      return;
    }

    try {
      setSavingId(reviewId);
      const res = await fetch(`/api/reviews/${reviewId}/respond`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: responseText.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(data.message);
        // Update the review in local state
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId
              ? {
                  ...r,
                  ownerResponse: responseText.trim(),
                  ownerResponseAt: new Date().toISOString(),
                }
              : r
          )
        );
        // Close the response editor
        setRespondingId(null);
        setResponseText("");
      } else {
        toast.error(data.error || "Nie udalo sie zapisac odpowiedzi");
      }
    } catch (error) {
      console.error("[Reviews Page] Save response error:", error);
      toast.error("Wystapil blad podczas zapisywania odpowiedzi");
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteResponse = async (reviewId: string) => {
    try {
      setSavingId(reviewId);
      const res = await fetch(`/api/reviews/${reviewId}/respond`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        toast.success(data.message);
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId
              ? { ...r, ownerResponse: null, ownerResponseAt: null }
              : r
          )
        );
      } else {
        toast.error(data.error || "Nie udalo sie usunac odpowiedzi");
      }
    } catch (error) {
      console.error("[Reviews Page] Delete response error:", error);
      toast.error("Wystapil blad");
    } finally {
      setSavingId(null);
    }
  };

  const openResponseEditor = (reviewId: string, existingResponse?: string | null) => {
    setRespondingId(reviewId);
    setResponseText(existingResponse || "");
  };

  const closeResponseEditor = () => {
    setRespondingId(null);
    setResponseText("");
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "\u2014";
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

                  {/* Existing owner response display */}
                  {review.ownerResponse && respondingId !== review.id && (
                    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquareReply className="w-4 h-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                          Odpowiedz wlasciciela
                        </span>
                        {review.ownerResponseAt && (
                          <span className="text-xs text-blue-500">
                            {formatDate(review.ownerResponseAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-blue-900 dark:text-blue-100">
                        {review.ownerResponse}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => openResponseEditor(review.id, review.ownerResponse)}
                        >
                          <Pencil className="w-3 h-3 mr-1" />
                          Edytuj
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleDeleteResponse(review.id)}
                          disabled={savingId === review.id}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Usun
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Response editor (inline) */}
                  {respondingId === review.id && (
                    <div className="border border-border rounded-md p-4 mb-3 bg-muted/20">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium flex items-center gap-1">
                          <MessageSquareReply className="w-4 h-4" />
                          Odpowiedz na opinie
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerateResponse(review.id)}
                          disabled={generatingId === review.id}
                          className="text-purple-600 hover:text-purple-700 border-purple-300 hover:border-purple-400"
                        >
                          {generatingId === review.id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                              Generowanie...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4 mr-1" />
                              Generuj odpowiedz AI
                            </>
                          )}
                        </Button>
                      </div>
                      <Textarea
                        value={responseText}
                        onChange={(e) => setResponseText(e.target.value)}
                        placeholder="Wpisz odpowiedz na opinie klienta lub uzyj AI..."
                        className="min-h-[100px] mb-3"
                        maxLength={2000}
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {responseText.length}/2000 znakow
                        </span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={closeResponseEditor}
                          >
                            Anuluj
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSaveResponse(review.id)}
                            disabled={savingId === review.id || !responseText.trim()}
                          >
                            {savingId === review.id ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                Zapisywanie...
                              </>
                            ) : (
                              <>
                                <Send className="w-4 h-4 mr-1" />
                                Zapisz odpowiedz
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border">
                    {review.status === "pending" && (
                      <>
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
                      </>
                    )}
                    {/* Show respond button if not already editing and no existing response */}
                    {!review.ownerResponse && respondingId !== review.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openResponseEditor(review.id)}
                        className="ml-auto"
                      >
                        <MessageSquareReply className="w-4 h-4 mr-1" />
                        Odpowiedz
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
