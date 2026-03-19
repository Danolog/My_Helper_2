"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { cn } from "@/lib/utils";

/**
 * Floating microphone button that captures voice commands, sends them
 * through STT (via useVoiceInput) and then to the AI interpret-command
 * endpoint for structured action mapping (navigation, search, etc.).
 *
 * Only rendered for Pro plan subscribers on browsers that support
 * MediaRecorder (checked by useVoiceInput.isSupported).
 */
export function VoiceCommandButton() {
  const router = useRouter();
  const { isProPlan, loading: subscriptionLoading } = useSubscription();
  const [showTranscript, setShowTranscript] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");

  /**
   * Called after STT returns a transcript. Sends the text to the
   * interpret-command endpoint and executes the resulting action.
   */
  const handleTranscript = useCallback(
    async (text: string) => {
      setLastTranscript(text);
      setInterpreting(true);

      try {
        const res = await fetch("/api/ai/voice/interpret-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });

        const data = await res.json();

        if (data.success && data.action) {
          toast.success(data.displayText || data.intent);

          if (
            (data.action.type === "navigate" ||
              data.action.type === "create_appointment" ||
              data.action.type === "check_schedule") &&
            data.action.path
          ) {
            router.push(data.action.path);
          }
        } else {
          toast.info(
            data.displayText ||
              data.error ||
              "Nie rozpoznano komendy",
          );
        }
      } catch {
        toast.error("Blad przetwarzania komendy glosowej");
      } finally {
        setInterpreting(false);
        setShowTranscript(false);
      }
    },
    [router],
  );

  const {
    isListening,
    isProcessing: sttProcessing,
    startListening,
    stopListening,
    isSupported,
  } = useVoiceInput({
    onTranscript: handleTranscript,
    onError: (error) => {
      toast.error(error);
      setShowTranscript(false);
    },
  });

  // Don't render until subscription data is loaded, or if
  // the user isn't on Pro, or the browser lacks MediaRecorder.
  if (subscriptionLoading || !isProPlan || !isSupported) return null;

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      setShowTranscript(true);
      setLastTranscript("");
      startListening();
    }
  };

  const handleDismiss = () => {
    stopListening();
    setShowTranscript(false);
  };

  return (
    <>
      {/* Floating mic button — positioned above bottom nav on mobile */}
      <div className="fixed bottom-24 right-6 md:bottom-6 z-50">
        <motion.div
          animate={isListening ? { scale: [1, 1.1, 1] } : { scale: 1 }}
          transition={
            isListening
              ? { repeat: Infinity, duration: 1.5, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        >
          <Button
            size="lg"
            className={cn(
              "h-14 w-14 rounded-full shadow-lg",
              isListening && "bg-red-500 hover:bg-red-600",
            )}
            onClick={handleClick}
            disabled={sttProcessing || interpreting}
            aria-label={isListening ? "Zatrzymaj nagrywanie" : "Komenda glosowa"}
          >
            {sttProcessing || interpreting ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : isListening ? (
              <MicOff className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </Button>
        </motion.div>
      </div>

      {/* Live transcript overlay shown while recording / processing */}
      <AnimatePresence>
        {showTranscript && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-44 md:bottom-24 right-6 z-50 w-72 rounded-lg border bg-background/95 backdrop-blur-sm p-4 shadow-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium flex items-center gap-2">
                <Mic className="h-4 w-4 text-primary" />
                {isListening
                  ? "Slucham..."
                  : sttProcessing
                    ? "Rozpoznawanie mowy..."
                    : interpreting
                      ? "Przetwarzanie komendy..."
                      : "Gotowe"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleDismiss}
                aria-label="Zamknij"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            {/* Audio waveform animation while listening */}
            {isListening && (
              <div className="flex items-center justify-center gap-1 mb-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-primary rounded-full"
                    animate={{ height: [8, 20, 8] }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.8,
                      delay: i * 0.15,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </div>
            )}

            {/* Processing spinner for STT / interpretation phases */}
            {(sttProcessing || interpreting) && !isListening && (
              <div className="flex justify-center mb-2">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Display the transcribed text */}
            {lastTranscript && (
              <p className="text-sm text-muted-foreground italic">
                &ldquo;{lastTranscript}&rdquo;
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
