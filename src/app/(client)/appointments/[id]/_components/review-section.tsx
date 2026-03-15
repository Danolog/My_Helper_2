"use client";

import { Star, MessageSquare, RefreshCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewInfo } from "../_types";

interface ReviewSectionProps {
  existingReview: ReviewInfo | null;
  reviewLoading: boolean;
  showReviewForm: boolean;
  reviewRating: number;
  reviewHoverRating: number;
  reviewComment: string;
  submittingReview: boolean;
  onShowReviewForm: () => void;
  onResetReviewForm: () => void;
  onSetRating: (rating: number) => void;
  onSetHoverRating: (rating: number) => void;
  onSetComment: (comment: string) => void;
  onSubmitReview: () => void;
}

export function ReviewSection({
  existingReview,
  reviewLoading,
  showReviewForm,
  reviewRating,
  reviewHoverRating,
  reviewComment,
  submittingReview,
  onShowReviewForm,
  onResetReviewForm,
  onSetRating,
  onSetHoverRating,
  onSetComment,
  onSubmitReview,
}: ReviewSectionProps) {
  return (
    <Card className="mb-4" data-testid="review-section-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Star className="w-5 h-5 text-primary" />
          Opinia
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reviewLoading && (
          <div className="flex justify-center items-center py-6">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Existing review display */}
        {!reviewLoading && existingReview && (
          <ExistingReviewDisplay review={existingReview} />
        )}

        {/* Leave Review button */}
        {!reviewLoading && !existingReview && !showReviewForm && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3">
              Podziel sie swoimi wrazeniami z wizyty
            </p>
            <Button onClick={onShowReviewForm} data-testid="leave-review-btn">
              <MessageSquare className="w-4 h-4 mr-2" />
              Wystaw opinie
            </Button>
          </div>
        )}

        {/* Review form */}
        {!reviewLoading && !existingReview && showReviewForm && (
          <ReviewForm
            reviewRating={reviewRating}
            reviewHoverRating={reviewHoverRating}
            reviewComment={reviewComment}
            submittingReview={submittingReview}
            onSetRating={onSetRating}
            onSetHoverRating={onSetHoverRating}
            onSetComment={onSetComment}
            onSubmit={onSubmitReview}
            onCancel={onResetReviewForm}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Existing review display (private sub-component)
// ---------------------------------------------------------------------------

function ExistingReviewDisplay({ review }: { review: ReviewInfo }) {
  return (
    <div className="space-y-3" data-testid="existing-review">
      <div className="flex items-center gap-1" data-testid="review-stars-display">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-5 h-5 ${
              star <= review.rating
                ? "fill-yellow-400 text-yellow-400"
                : "text-gray-300 dark:text-gray-600"
            }`}
          />
        ))}
        <span className="text-sm font-medium ml-2">{review.rating}/5</span>
      </div>

      {review.comment && (
        <div
          className="p-3 rounded-md bg-muted/50 border"
          data-testid="review-comment-display"
        >
          <p className="text-sm">{review.comment}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={
            review.status === "pending"
              ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
              : review.status === "approved"
                ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700"
                : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700"
          }
          data-testid="review-status-badge"
        >
          {review.status === "pending" && "Oczekuje na moderacje"}
          {review.status === "approved" && "Zatwierdzona"}
          {review.status === "rejected" && "Odrzucona"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {new Date(review.createdAt).toLocaleDateString("pl-PL")}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review form (private sub-component)
// ---------------------------------------------------------------------------

interface ReviewFormProps {
  reviewRating: number;
  reviewHoverRating: number;
  reviewComment: string;
  submittingReview: boolean;
  onSetRating: (rating: number) => void;
  onSetHoverRating: (rating: number) => void;
  onSetComment: (comment: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function ReviewForm({
  reviewRating,
  reviewHoverRating,
  reviewComment,
  submittingReview,
  onSetRating,
  onSetHoverRating,
  onSetComment,
  onSubmit,
  onCancel,
}: ReviewFormProps) {
  return (
    <div className="space-y-4" data-testid="review-form">
      {/* Star rating input */}
      <div>
        <label className="text-sm font-medium mb-2 block">Ocena</label>
        <div className="flex items-center gap-1" data-testid="star-rating-input">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => onSetRating(star)}
              onMouseEnter={() => onSetHoverRating(star)}
              onMouseLeave={() => onSetHoverRating(0)}
              className="p-0.5 transition-transform hover:scale-110"
              data-testid={`star-${star}`}
            >
              <Star
                className={`w-8 h-8 transition-colors ${
                  star <= (reviewHoverRating || reviewRating)
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-gray-300 dark:text-gray-600"
                }`}
              />
            </button>
          ))}
          {reviewRating > 0 && (
            <span
              className="text-sm font-medium ml-2"
              data-testid="rating-label"
            >
              {reviewRating}/5
            </span>
          )}
        </div>
      </div>

      {/* Comment textarea */}
      <div>
        <label className="text-sm font-medium mb-2 block">
          Komentarz (opcjonalnie)
        </label>
        <Textarea
          placeholder="Opisz swoje wrazenia z wizyty..."
          value={reviewComment}
          onChange={(e) => onSetComment(e.target.value)}
          rows={4}
          className="resize-none"
          data-testid="review-comment-input"
        />
      </div>

      {/* Submit buttons */}
      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={submittingReview}
          data-testid="cancel-review-btn"
        >
          Anuluj
        </Button>
        <Button
          onClick={onSubmit}
          disabled={submittingReview || reviewRating === 0}
          data-testid="submit-review-btn"
        >
          {submittingReview ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Wysylanie...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Wyslij opinie
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
