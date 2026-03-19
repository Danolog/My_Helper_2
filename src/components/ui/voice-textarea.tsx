"use client";

// ---------------------------------------------------------------------------
// VoiceTextarea — a standard Textarea with an integrated microphone button.
// When the user taps the mic, audio is recorded via MediaRecorder and sent
// to the ElevenLabs STT endpoint. The transcribed text is appended to the
// textarea value.
// ---------------------------------------------------------------------------

import { useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { cn } from "@/lib/utils";

interface VoiceTextareaProps extends React.ComponentProps<typeof Textarea> {
  /** Called when the value changes (either by typing or voice transcription) */
  onValueChange?: (value: string) => void;
}

export function VoiceTextarea({
  onValueChange,
  className,
  ...props
}: VoiceTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isListening, isProcessing, startListening, stopListening, isSupported } =
    useVoiceInput({
      onTranscript: (text) => {
        if (textareaRef.current) {
          const current = textareaRef.current.value;
          const newValue = current ? `${current} ${text}` : text;

          // Use the native setter to update the value so that React's
          // synthetic onChange fires correctly for both controlled and
          // uncontrolled patterns.
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value"
          )?.set;
          nativeInputValueSetter?.call(textareaRef.current, newValue);
          textareaRef.current.dispatchEvent(
            new Event("input", { bubbles: true })
          );

          onValueChange?.(newValue);
        }
      },
      onError: (error) => {
        toast.error(error);
      },
    });

  const handleMicClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        className={cn("pr-12", className)}
        {...props}
      />
      {isSupported && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "absolute right-2 top-2 h-8 w-8",
            isListening && "text-red-500 animate-pulse",
            isProcessing && "text-muted-foreground"
          )}
          onClick={handleMicClick}
          disabled={isProcessing}
          title={isListening ? "Zatrzymaj nagrywanie" : "Nagrywaj glos"}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isListening ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
