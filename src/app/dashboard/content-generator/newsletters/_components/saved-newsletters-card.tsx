"use client";

import {
  Mail,
  Loader2,
  Clock,
  FileText,
  Send,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SavedNewsletter } from "../_types";

type SavedNewslettersCardProps = {
  savedNewsletters: SavedNewsletter[];
  loadingSaved: boolean;
  onSend: (newsletter: SavedNewsletter) => void;
};

export function SavedNewslettersCard({
  savedNewsletters,
  loadingSaved,
  onSend,
}: SavedNewslettersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Zapisane newslettery
        </CardTitle>
        <CardDescription>
          Historia wygenerowanych i zapisanych newsletterow - kliknij
          &quot;Wyslij&quot; aby wyslac do klientow ze zgoda
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadingSaved ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : savedNewsletters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Mail className="h-12 w-12 opacity-20" />
            <p className="text-sm text-center">
              Nie masz jeszcze zapisanych newsletterow.
              <br />
              Wygeneruj newsletter i kliknij &quot;Zapisz&quot;.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {savedNewsletters.map((nl) => (
              <div
                key={nl.id}
                className="border rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{nl.subject}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {nl.content.slice(0, 200)}...
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {nl.sentAt ? (
                      <Badge
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                      >
                        Wyslany
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Wersja robocza</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(nl.createdAt).toLocaleDateString("pl-PL", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {nl.recipientsCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {nl.recipientsCount} odbiorcow
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={nl.sentAt ? "outline" : "default"}
                    onClick={() => onSend(nl)}
                    className="flex items-center gap-1"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {nl.sentAt ? "Wyslij ponownie" : "Wyslij"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
