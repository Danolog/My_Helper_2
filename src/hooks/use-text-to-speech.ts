"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// useTextToSpeech — sends text to the ElevenLabs TTS API route
// (/api/ai/voice/tts), receives an audio/mpeg stream, and plays it
// through an HTMLAudioElement.
//
// All speech synthesis happens server-side through ElevenLabs; the
// browser-native SpeechSynthesis API is never used.
// ---------------------------------------------------------------------------

interface UseTextToSpeechOptions {
  /** Called when an error occurs during TTS generation or playback */
  onError?: (error: string) => void;
}

interface UseTextToSpeechReturn {
  /** Generate speech from text and play it */
  speak: (text: string) => Promise<void>;
  /** Stop current playback */
  stop: () => void;
  /** Whether audio is currently playing */
  isSpeaking: boolean;
  /** Whether the TTS request is in-flight */
  isLoading: boolean;
}

export function useTextToSpeech(
  options: UseTextToSpeechOptions = {}
): UseTextToSpeechReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Store onError in a ref to avoid stale closures and prevent it
  // from appearing in useCallback dependency arrays.
  const onErrorRef = useRef(options.onError);
  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsSpeaking(false);
    setIsLoading(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      // Stop any current playback before starting a new request
      stop();

      if (!text.trim()) return;

      setIsLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ai/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res
            .json()
            .catch(() => ({ error: "Blad TTS" })) as { error?: string };
          throw new Error(data.error ?? "Blad generowania mowy");
        }

        const audioBlob = await res.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onplay = () => {
          setIsLoading(false);
          setIsSpeaking(true);
        };

        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
        };

        audio.onerror = () => {
          setIsSpeaking(false);
          setIsLoading(false);
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          onErrorRef.current?.("Blad odtwarzania dzwieku");
        };

        await audio.play();
      } catch (error) {
        // AbortError means the user (or cleanup) intentionally cancelled
        if (error instanceof Error && error.name === "AbortError") return;

        setIsLoading(false);
        setIsSpeaking(false);
        const msg =
          error instanceof Error
            ? error.message
            : "Blad generowania mowy";
        onErrorRef.current?.(msg);
      }
    },
    [stop]
  );

  // Cleanup on unmount: stop playback, abort pending requests, revoke URLs
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
        audioRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  return { speak, stop, isSpeaking, isLoading };
}
