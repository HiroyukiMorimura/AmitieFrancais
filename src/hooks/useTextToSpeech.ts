import { useRef, useCallback, useState, useEffect } from "react";

type UseTextToSpeechOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
};

export function useTextToSpeech(options: UseTextToSpeechOptions = {}) {
  const { lang = "fr-FR", rate = 1.0, pitch = 1.0, volume = 1.0 } = options;

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // 指定言語の音声が利用可能かどうか
  const [hasVoice, setHasVoice] = useState<boolean | null>(null); // null = まだ判定中

  // 言語に一致する Voice を探す
  const findVoice = useCallback((): SpeechSynthesisVoice | undefined => {
    if (!("speechSynthesis" in window)) return undefined;
    const voices = window.speechSynthesis.getVoices();
    // lang の先頭2文字（例: "fr"）で前方一致
    const prefix = lang.slice(0, 2).toLowerCase();
    return (
      voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
    );
  }, [lang]);

  // 音声リストの非同期読み込み対応
  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setHasVoice(false);
      return;
    }

    const check = () => {
      const v = findVoice();
      setHasVoice(v !== undefined);
    };

    // 初回チェック（Chrome では空配列の場合あり）
    check();

    // voiceschanged イベントで再チェック
    window.speechSynthesis.addEventListener("voiceschanged", check);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", check);
    };
  }, [findVoice]);

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

      // マッチする voice を明示的に設定（フォールバック防止）
      const voice = findVoice();
      if (voice) {
        utterance.voice = voice;
      }

      utteranceRef.current = utterance;

      window.speechSynthesis.speak(utterance);
    },
    [lang, rate, pitch, volume, findVoice]
  );

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
  }, []);

  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  return { speak, stop, isSupported, hasVoice };
}
