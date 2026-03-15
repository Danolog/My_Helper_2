"use client";

import { MessageSquare } from "lucide-react";
import { getStatusBadge, getTypeBadge, formatDate } from "../_types";
import type { Notification } from "../_types";

interface NotificationsListProps {
  notifications: Notification[];
  loading: boolean;
  error: string | null;
}

/**
 * Render a notification message with URLs converted to clickable links.
 * Detects http:// and https:// URLs and renders them as anchor tags.
 */
function renderMessageWithLinks(message: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = message.split(urlRegex);

  if (parts.length === 1) {
    // No URLs found, return plain text
    return <>{message}</>;
  }

  return (
    <>
      {parts.map((part, index) => {
        if (urlRegex.test(part)) {
          // Reset regex lastIndex since we're reusing it
          urlRegex.lastIndex = 0;
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:text-primary/80 font-medium"
              data-testid="notification-booking-link"
            >
              {part}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function NotificationsList({ notifications, loading, error }: NotificationsListProps) {
  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-muted-foreground">Ladowanie powiadomien...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">Brak powiadomien</h3>
        <p className="text-muted-foreground">
          Powiadomienia SMS pojawia sie tutaj po potwierdzeniu platnosci.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {getTypeBadge(n.type)}
                {getStatusBadge(n.status)}
                {n.clientName && (
                  <span className="text-sm font-medium">{n.clientName}</span>
                )}
                {n.clientPhone && (
                  <span className="text-sm text-muted-foreground">
                    ({n.clientPhone})
                  </span>
                )}
              </div>
              <p className="text-sm text-foreground break-words" data-testid="notification-message">{renderMessageWithLinks(n.message)}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
              {n.sentAt ? (
                <div>Wyslano: {formatDate(n.sentAt)}</div>
              ) : (
                <div>Utworzono: {formatDate(n.createdAt)}</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
