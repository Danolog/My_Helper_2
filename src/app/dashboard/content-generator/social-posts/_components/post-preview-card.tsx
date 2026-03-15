"use client";

import {
  Hash,
  Loader2,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Pencil,
  Calendar,
  CalendarClock,
  Clock,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { POST_TYPES } from "../_types";
import { PLATFORMS } from "./platforms";
import type { GeneratedPost } from "../_types";

type PostPreviewCardProps = {
  isGenerating: boolean;
  generatedPost: GeneratedPost | null;
  isEditing: boolean;
  editedPost: string;
  onEditedPostChange: (value: string) => void;
  copied: boolean;
  onCopy: () => void;
  onToggleEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRegenerate: () => void;
  // Scheduling
  showScheduleDialog: boolean;
  onShowScheduleDialogChange: (value: boolean) => void;
  scheduleDate: string;
  onScheduleDateChange: (value: string) => void;
  isScheduling: boolean;
  onSchedule: () => void;
  onOpenScheduleDialog: () => void;
};

export function PostPreviewCard({
  isGenerating,
  generatedPost,
  isEditing,
  editedPost,
  onEditedPostChange,
  copied,
  onCopy,
  onToggleEdit,
  onSaveEdit,
  onCancelEdit,
  onRegenerate,
  showScheduleDialog,
  onShowScheduleDialogChange,
  scheduleDate,
  onScheduleDateChange,
  isScheduling,
  onSchedule,
  onOpenScheduleDialog,
}: PostPreviewCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          Wygenerowany post
        </CardTitle>
        <CardDescription>
          Podglad wygenerowanej tresci - skopiuj lub zaplanuj publikacje
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              AI generuje tresc posta...
            </p>
          </div>
        ) : generatedPost ? (
          <div className="space-y-4">
            {/* Platform and type badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="flex items-center gap-1">
                {PLATFORMS.find((p) => p.value === generatedPost.platform)
                  ?.icon}
                {PLATFORMS.find((p) => p.value === generatedPost.platform)
                  ?.label}
              </Badge>
              <Badge variant="outline">
                {POST_TYPES.find(
                  (pt) => pt.value === generatedPost.postType
                )?.label}
              </Badge>
              <Badge
                variant={
                  generatedPost.characterCount > generatedPost.maxLength
                    ? "destructive"
                    : "secondary"
                }
              >
                {generatedPost.characterCount}/{generatedPost.maxLength}{" "}
                znakow
              </Badge>
            </div>

            {/* Post content - editable */}
            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editedPost}
                  onChange={(e) => onEditedPostChange(e.target.value)}
                  rows={8}
                  className="text-sm leading-relaxed resize-y min-h-[120px]"
                  data-testid="edit-post-textarea"
                />
                <div className="flex items-center justify-between">
                  <Badge
                    variant={
                      editedPost.length > generatedPost.maxLength
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {editedPost.length}/{generatedPost.maxLength} znakow
                  </Badge>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCancelEdit}
                    >
                      Anuluj
                    </Button>
                    <Button
                      size="sm"
                      onClick={onSaveEdit}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Zapisz zmiany
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="bg-muted/50 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed border cursor-pointer hover:border-primary/50 transition-colors group relative"
                onClick={onToggleEdit}
                data-testid="post-content-display"
              >
                {generatedPost.post}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Badge variant="secondary" className="text-xs">
                    <Pencil className="h-3 w-3 mr-1" />
                    Kliknij aby edytowac
                  </Badge>
                </div>
              </div>
            )}

            {/* Hashtags extracted */}
            {generatedPost.hashtags.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Wyodrebnione hashtagi ({generatedPost.hashtags.length})
                </Label>
                <div className="flex flex-wrap gap-1">
                  {generatedPost.hashtags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="default"
                className="flex-1"
                onClick={onCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Skopiowano!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Kopiuj do schowka
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onToggleEdit}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edytuj
              </Button>
              <Button
                variant="outline"
                onClick={onRegenerate}
                disabled={isGenerating}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Generuj ponownie
              </Button>
            </div>

            {/* Schedule button */}
            <Dialog open={showScheduleDialog} onOpenChange={onShowScheduleDialogChange}>
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={onOpenScheduleDialog}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Zaplanuj publikacje
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <CalendarClock className="h-5 w-5" />
                    Zaplanuj publikacje posta
                  </DialogTitle>
                  <DialogDescription>
                    Wybierz date i godzine, kiedy post ma zostac opublikowany
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {/* Post preview */}
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="flex items-center gap-1">
                      {PLATFORMS.find((p) => p.value === generatedPost.platform)?.icon}
                      {PLATFORMS.find((p) => p.value === generatedPost.platform)?.label}
                    </Badge>
                    <Badge variant="outline">
                      {POST_TYPES.find((pt) => pt.value === generatedPost.postType)?.label}
                    </Badge>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 text-sm max-h-32 overflow-y-auto border">
                    {generatedPost.post.substring(0, 200)}
                    {generatedPost.post.length > 200 && "..."}
                  </div>

                  {/* Date/time picker */}
                  <div className="space-y-2">
                    <Label htmlFor="schedule-date" className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Data i godzina publikacji
                    </Label>
                    <Input
                      id="schedule-date"
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={(e) => onScheduleDateChange(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                    />
                  </div>

                  {scheduleDate && (
                    <p className="text-sm text-muted-foreground">
                      Post zostanie opublikowany:{" "}
                      <span className="font-medium text-foreground">
                        {new Date(scheduleDate).toLocaleDateString("pl-PL", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => onShowScheduleDialogChange(false)}
                  >
                    Anuluj
                  </Button>
                  <Button
                    onClick={onSchedule}
                    disabled={isScheduling || !scheduleDate}
                  >
                    {isScheduling ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Planowanie...
                      </>
                    ) : (
                      <>
                        <Calendar className="h-4 w-4 mr-2" />
                        Potwierdz planowanie
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Sparkles className="h-12 w-12 opacity-20" />
            <p className="text-sm text-center">
              Skonfiguruj post i kliknij &quot;Wygeneruj post&quot; aby
              otrzymac tresc gotowa do publikacji
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
