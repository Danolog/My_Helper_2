"use client";

import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { POST_TYPES, TONES } from "../_types";
import { PLATFORMS } from "./platforms";
import type { Platform, PostType, Tone } from "../_types";

type PostConfigCardProps = {
  platform: Platform;
  onPlatformChange: (value: Platform) => void;
  postType: PostType;
  onPostTypeChange: (value: PostType) => void;
  tone: Tone;
  onToneChange: (value: Tone) => void;
  context: string;
  onContextChange: (value: string) => void;
  includeEmoji: boolean;
  onIncludeEmojiChange: (value: boolean) => void;
  includeHashtags: boolean;
  onIncludeHashtagsChange: (value: boolean) => void;
  isGenerating: boolean;
  onGenerate: () => void;
};

export function PostConfigCard({
  platform,
  onPlatformChange,
  postType,
  onPostTypeChange,
  tone,
  onToneChange,
  context,
  onContextChange,
  includeEmoji,
  onIncludeEmojiChange,
  includeHashtags,
  onIncludeHashtagsChange,
  isGenerating,
  onGenerate,
}: PostConfigCardProps) {
  const selectedPostType = POST_TYPES.find((pt) => pt.value === postType);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Konfiguracja posta
        </CardTitle>
        <CardDescription>
          Wybierz platforme, typ posta i dodaj kontekst
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Platform selection */}
        <div className="space-y-2">
          <Label>Platforma</Label>
          <div className="flex gap-2">
            {PLATFORMS.map((p) => (
              <Button
                key={p.value}
                variant={platform === p.value ? "default" : "outline"}
                size="sm"
                className="flex items-center gap-2"
                onClick={() => onPlatformChange(p.value)}
              >
                {p.icon}
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Post type */}
        <div className="space-y-2">
          <Label>Typ posta</Label>
          <Select
            value={postType}
            onValueChange={(v) => onPostTypeChange(v as PostType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POST_TYPES.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  <span className="font-medium">{pt.label}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    — {pt.description}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedPostType && (
            <p className="text-xs text-muted-foreground">
              {selectedPostType.description}
            </p>
          )}
        </div>

        {/* Tone */}
        <div className="space-y-2">
          <Label>Ton komunikacji</Label>
          <Select
            value={tone}
            onValueChange={(v) => onToneChange(v as Tone)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Context */}
        <div className="space-y-2">
          <Label htmlFor="context">
            Dodatkowy kontekst{" "}
            <span className="text-muted-foreground text-xs">
              (opcjonalnie)
            </span>
          </Label>
          <Textarea
            id="context"
            placeholder="Np. nowa promocja -20% na koloryzacje, otwarcie nowego gabinetu, sezon letni..."
            value={context}
            onChange={(e) => onContextChange(e.target.value)}
            rows={3}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground text-right">
            {context.length}/500
          </p>
        </div>

        {/* Options */}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeEmoji}
              onChange={(e) => onIncludeEmojiChange(e.target.checked)}
              className="rounded border-gray-300"
            />
            Emoji
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeHashtags}
              onChange={(e) => onIncludeHashtagsChange(e.target.checked)}
              className="rounded border-gray-300"
            />
            Hashtagi
          </label>
        </div>

        {/* Generate button */}
        <Button
          className="w-full"
          size="lg"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generowanie...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Wygeneruj post
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
