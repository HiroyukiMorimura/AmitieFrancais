// src/hooks/useDrillHotkeys.ts
import { useEffect, useRef } from "react";

type HotkeyArgs = {
  enabled: boolean;
  revealed: boolean;
  setRevealed: (v: boolean) => void;
  onCorrect: () => void;
  onWrong: () => void;
  onNext: () => void;
  onPrev: () => void;
};

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

export function useDrillHotkeys(args: HotkeyArgs) {
  const ref = useRef(args);
  useEffect(() => {
    ref.current = args;
  }, [args]);

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const {
        enabled,
        revealed,
        setRevealed,
        onCorrect,
        onWrong,
        onNext,
        onPrev,
      } = ref.current;

      if (!enabled) return;
      if (e.repeat || e.isComposing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      switch (e.code) {
        case "Space": {
          e.preventDefault();
          if (!revealed) setRevealed(true);
          else onNext();
          break;
        }
        case "KeyS": {
          // 表示済みのときだけ「正解」
          if (revealed) onCorrect();
          break;
        }
        case "KeyF": {
          // 表示済みのときだけ「不正解」
          if (revealed) onWrong();
          break;
        }
        case "ArrowRight":
        case "KeyC": {
          onNext();
          break;
        }
        case "ArrowLeft":
        case "KeyX": {
          onPrev();
          break;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);
}
