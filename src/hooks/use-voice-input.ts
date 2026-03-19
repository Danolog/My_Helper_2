"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// useVoiceInput — captures audio via MediaRecorder, sends it to the
// ElevenLabs STT API route (/api/ai/voice/stt), and returns the transcript.
//
// All speech recognition happens server-side through ElevenLabs; no
// browser-native Web Speech API is used.
// ---------------------------------------------------------------------------

interface UseVoiceInputOptions {
  /** Called with the transcribed text after successful STT */
  onTranscript?: (text: string) => void;
  /** Called when an error occurs during recording or transcription */
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  /** Whether the microphone is currently recording */
  isListening: boolean;
  /** Whether the recorded audio is being sent/processed by STT */
  isProcessing: boolean;
  /** The last transcribed text */
  transcript: string;
  /** Start recording audio from the microphone */
  startListening: () => void;
  /** Stop recording and trigger STT processing */
  stopListening: () => void;
  /** Whether MediaRecorder is available in this browser */
  isSupported: boolean;
}

export function useVoiceInput(
  options: UseVoiceInputOptions = {}
): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Store callbacks in refs to avoid stale closures and prevent the
  // callbacks from appearing in useCallback dependency arrays (which
  // would cause re-creation on every render when options is a new object).
  const onTranscriptRef = useRef(options.onTranscript);
  const onErrorRef = useRef(options.onError);
  useEffect(() => {
    onTranscriptRef.current = options.onTranscript;
    onErrorRef.current = options.onError;
  }, [options.onTranscript, options.onError]);

  const isSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  // Centralized cleanup: stop all media tracks and reset refs
  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) {
      onErrorRef.current?.(
        "Nagrywanie glosu nie jest wspierane w tej przegladarce"
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Release the microphone immediately after recording stops
        cleanupStream();

        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });

        if (audioBlob.size === 0) {
          onErrorRef.current?.("Nie nagrano dzwieku");
          return;
        }

        setIsProcessing(true);
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");

          const res = await fetch("/api/ai/voice/stt", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const data = (await res.json()) as { error?: string };
            throw new Error(data.error ?? "Blad rozpoznawania mowy");
          }

          const data = (await res.json()) as { text?: string };
          if (data.text) {
            setTranscript(data.text);
            onTranscriptRef.current?.(data.text);
          }
        } catch (error) {
          const msg =
            error instanceof Error
              ? error.message
              : "Blad rozpoznawania mowy";
          onErrorRef.current?.(msg);
        } finally {
          setIsProcessing(false);
        }
      };

      // Collect data in 1-second chunks so we don't lose audio if
      // the recorder is stopped between long intervals
      mediaRecorder.start(1000);
      setIsListening(true);
    } catch (error) {
      cleanupStream();

      if (
        error instanceof DOMException &&
        error.name === "NotAllowedError"
      ) {
        onErrorRef.current?.(
          "Brak dostepu do mikrofonu. Zezwol na dostep w ustawieniach przegladarki."
        );
      } else {
        onErrorRef.current?.("Nie udalo sie uruchomic nagrywania");
      }
    }
  }, [isSupported, cleanupStream]);

  const stopListening = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  // Cleanup on unmount: stop recording and release the microphone
  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === "recording"
      ) {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isListening,
    isProcessing,
    transcript,
    startListening,
    stopListening,
    isSupported,
  };
}
