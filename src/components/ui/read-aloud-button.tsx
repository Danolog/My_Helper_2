"use client";

// ---------------------------------------------------------------------------
// ReadAloudButton — a single button that reads the provided text aloud
// via the ElevenLabs TTS API route (/api/ai/voice/tts). Toggles between
// a speaker icon (idle), a spinner (loading), and a mute icon (playing).
// ---------------------------------------------------------------------------

import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useModuleEnabled } from "@/components/dashboard/modules-provider";
import { Button } from "@/components/ui/button";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";
import { cn } from "@/lib/utils";

interface ReadAloudButtonProps {
  /** The text to read aloud when the button is clicked */
  text: string;
  className?: string;
  variant?: "ghost" | "outline" | "default";
  size?: "default" | "sm" | "lg" | "icon";
}

export function ReadAloudButton({
  text,
  className,
  variant = "ghost",
  size = "icon",
}: ReadAloudButtonProps) {
  // Głos to moduł z rejestru (src/lib/features.ts) — wyłączony albo zamrożony:
  // przycisku nie ma (trasa TTS zwraca wtedy 404).
  const voiceEnabled = useModuleEnabled("voiceAi");
  const { speak, stop, isSpeaking, isLoading } = useTextToSpeech({
    onError: (error) => toast.error(error),
  });

  if (!voiceEnabled) return null;

  const handleClick = () => {
    if (isSpeaking) {
      stop();
    } else {
      void speak(text);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("shrink-0", className)}
      onClick={handleClick}
      disabled={isLoading || !text.trim()}
      title={isSpeaking ? "Zatrzymaj czytanie" : "Przeczytaj na glos"}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isSpeaking ? (
        <VolumeX className="h-4 w-4" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </Button>
  );
}
