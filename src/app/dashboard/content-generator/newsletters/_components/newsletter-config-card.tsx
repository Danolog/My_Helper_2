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
import { GOALS, TONES, LENGTHS } from "../_types";
import type { GoalType, Tone, Length } from "../_types";

type NewsletterConfigCardProps = {
  topic: string;
  onTopicChange: (value: string) => void;
  goals: GoalType;
  onGoalsChange: (value: GoalType) => void;
  tone: Tone;
  onToneChange: (value: Tone) => void;
  length: Length;
  onLengthChange: (value: Length) => void;
  includeCallToAction: boolean;
  onIncludeCallToActionChange: (value: boolean) => void;
  isGenerating: boolean;
  onGenerate: () => void;
};

export function NewsletterConfigCard({
  topic,
  onTopicChange,
  goals,
  onGoalsChange,
  tone,
  onToneChange,
  length,
  onLengthChange,
  includeCallToAction,
  onIncludeCallToActionChange,
  isGenerating,
  onGenerate,
}: NewsletterConfigCardProps) {
  const selectedGoal = GOALS.find((g) => g.value === goals);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Konfiguracja newslettera
        </CardTitle>
        <CardDescription>
          Okresl temat, cel i styl newslettera
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Topic / Context */}
        <div className="space-y-2">
          <Label htmlFor="topic">
            Temat / cel newslettera{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="topic"
            placeholder="Np. Promocja wiosenna -30% na wszystkie zabiegi pielegnacyjne, nowy zabieg lifting twarzy, zaproszenie na dzien otwarty..."
            value={topic}
            onChange={(e) => onTopicChange(e.target.value)}
            rows={3}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground text-right">
            {topic.length}/500
          </p>
        </div>

        {/* Goal */}
        <div className="space-y-2">
          <Label>Cel newslettera</Label>
          <Select
            value={goals}
            onValueChange={(v) => onGoalsChange(v as GoalType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GOALS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  <span className="font-medium">{g.label}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    — {g.description}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedGoal && (
            <p className="text-xs text-muted-foreground">
              {selectedGoal.description}
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

        {/* Length */}
        <div className="space-y-2">
          <Label>Dlugosc</Label>
          <div className="flex gap-2">
            {LENGTHS.map((l) => (
              <Button
                key={l.value}
                variant={length === l.value ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onLengthChange(l.value)}
              >
                <div className="text-center">
                  <div>{l.label}</div>
                  <div className="text-xs opacity-70">
                    {l.description}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeCallToAction}
              onChange={(e) =>
                onIncludeCallToActionChange(e.target.checked)
              }
              className="rounded border-gray-300"
            />
            Wezwanie do dzialania (CTA)
          </label>
        </div>

        {/* Generate button */}
        <Button
          className="w-full"
          size="lg"
          onClick={onGenerate}
          disabled={isGenerating || !topic.trim()}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generowanie...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Wygeneruj newsletter
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
