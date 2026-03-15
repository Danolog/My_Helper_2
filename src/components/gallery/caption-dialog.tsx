"use client";

import { useState } from "react";
import Image from "next/image";
import { Loader2, Pencil, Check, Sparkles, Copy, Instagram, Facebook, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mutationFetch } from "@/lib/api-client";
import type { GalleryPhoto, CaptionPlatform } from "./gallery-types";

interface CaptionDialogProps {
  photo: GalleryPhoto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CaptionDialog({
  photo,
  open,
  onOpenChange,
}: CaptionDialogProps) {
  const [platform, setPlatform] = useState<CaptionPlatform>("instagram");
  const [loading, setLoading] = useState(false);
  const [generatedCaption, setGeneratedCaption] = useState<string | null>(null);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCaption, setEditedCaption] = useState("");

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      // Reset state when dialog closes
      setGeneratedCaption(null);
      setHashtags([]);
      setCopied(false);
      setPlatform("instagram");
      setIsEditing(false);
      setEditedCaption("");
    }
  };

  const handleGenerate = async () => {
    if (!photo) return;
    setLoading(true);
    setGeneratedCaption(null);
    setHashtags([]);
    setCopied(false);

    try {
      const res = await mutationFetch("/api/ai/content/photo-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoId: photo.id,
          platform,
          includeEmoji: true,
          includeHashtags: true,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setGeneratedCaption(data.caption);
        setEditedCaption(data.caption);
        setIsEditing(false);
        setHashtags(data.hashtags || []);
      } else {
        toast.error(data.error || "Blad podczas generowania podpisu");
      }
    } catch {
      toast.error("Blad podczas generowania podpisu");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedCaption) return;
    const textToCopy = editedCaption || generatedCaption;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success("Skopiowano do schowka!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  };

  const handleToggleEdit = () => {
    if (!isEditing && generatedCaption) {
      setEditedCaption(editedCaption || generatedCaption);
    }
    setIsEditing(!isEditing);
  };

  const handleSaveEdit = () => {
    if (generatedCaption) {
      setGeneratedCaption(editedCaption);
      setIsEditing(false);
      toast.success("Zmiany zapisane!");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Generuj post z galerii
          </DialogTitle>
        </DialogHeader>

        {photo && (
          <div className="space-y-4 mt-4">
            {/* Photo preview */}
            <div className="flex gap-4">
              <div className="relative w-32 h-32 rounded-lg overflow-hidden border flex-shrink-0">
                <Image
                  src={photo.afterPhotoUrl || photo.beforePhotoUrl || ""}
                  alt={photo.description || "Zdjecie"}
                  fill
                  className="object-cover"
                  sizes="128px"
                />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                {photo.serviceName && (
                  <p className="text-sm font-medium">{photo.serviceName}</p>
                )}
                {photo.employeeFirstName && (
                  <p className="text-sm text-muted-foreground">
                    {photo.employeeFirstName} {photo.employeeLastName}
                  </p>
                )}
                {photo.techniques && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Techniki:</span> {photo.techniques}
                  </p>
                )}
                {photo.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{photo.description}</p>
                )}
                {photo.beforePhotoUrl && photo.afterPhotoUrl && (
                  <Badge variant="secondary" className="text-xs">
                    <SlidersHorizontal className="w-3 h-3 mr-1" />
                    Przed / Po
                  </Badge>
                )}
              </div>
            </div>

            {/* Platform selection */}
            <div>
              <Label className="mb-2 block text-sm font-medium">Platforma</Label>
              <div className="flex gap-2">
                <Button
                  variant={platform === "instagram" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPlatform("instagram")}
                  className="flex-1"
                >
                  <Instagram className="w-4 h-4 mr-2" />
                  Instagram
                </Button>
                <Button
                  variant={platform === "facebook" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPlatform("facebook")}
                  className="flex-1"
                >
                  <Facebook className="w-4 h-4 mr-2" />
                  Facebook
                </Button>
                <Button
                  variant={platform === "tiktok" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPlatform("tiktok")}
                  className="flex-1"
                >
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78 2.92 2.92 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 3 15.57 6.33 6.33 0 0 0 9.37 22a6.33 6.33 0 0 0 6.45-6.21V8.73a8.16 8.16 0 0 0 4.77 1.53v-3.4a4.85 4.85 0 0 1-1-.17z" />
                  </svg>
                  TikTok
                </Button>
              </div>
            </div>

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generowanie podpisu...
                </>
              ) : generatedCaption ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Wygeneruj ponownie
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generuj podpis
                </>
              )}
            </Button>

            {/* Generated caption */}
            {generatedCaption && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Wygenerowany podpis</Label>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {(isEditing ? editedCaption : generatedCaption).length} znakow
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleEdit}
                      className="h-7"
                    >
                      <Pencil className="w-3 h-3 mr-1" />
                      {isEditing ? "Anuluj" : "Edytuj"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopy}
                      className="h-7"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 mr-1" />
                          Skopiowano
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 mr-1" />
                          Kopiuj
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editedCaption}
                      onChange={(e) => setEditedCaption(e.target.value)}
                      rows={6}
                      className="text-sm leading-relaxed resize-y min-h-[100px]"
                      data-testid="edit-caption-textarea"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Zapisz zmiany
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="p-4 bg-muted/50 rounded-lg border text-sm whitespace-pre-wrap leading-relaxed cursor-pointer hover:border-primary/50 transition-colors group relative"
                    onClick={handleToggleEdit}
                    data-testid="generated-caption"
                  >
                    {generatedCaption}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Badge variant="secondary" className="text-xs">
                        <Pencil className="h-3 w-3 mr-1" />
                        Edytuj
                      </Badge>
                    </div>
                  </div>
                )}

                {/* Hashtags */}
                {hashtags.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Znalezione hashtagi ({hashtags.length})
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {hashtags.map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
