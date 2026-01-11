import { useRef, useCallback } from "react";

type UseTextToSpeechOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
};

export function useTextToSpeech(options: UseTextToSpeechOptions = {}) {
  const { lang = "fr-FR", rate = 1.0, pitch = 1.0, volume = 1.0 } = options;

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speak = useCallback(
    (text: string) => {
      // 既存の読み上げを停止
      if (utteranceRef.current) {
        window.speechSynthesis.cancel();
      }

      // ブラウザサポートチェック
      if (!("speechSynthesis" in window)) {
        console.warn("Speech synthesis is not supported in this browser.");
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;

      utteranceRef.current = utterance;

      window.speechSynthesis.speak(utterance);
    },
    [lang, rate, pitch, volume]
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
  }, []);

  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  return { speak, stop, isSupported };
}

