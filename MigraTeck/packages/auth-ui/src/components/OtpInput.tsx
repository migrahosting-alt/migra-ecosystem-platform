"use client";

import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";

export function OtpInput({
  value,
  onChange,
  length = 6,
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  length?: number;
  className?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function updateDigit(index: number, nextValue: string) {
    if (!/^\d*$/.test(nextValue)) {
      return;
    }

    const next = [...value];
    next[index] = nextValue.slice(-1);
    onChange(next);

    if (nextValue && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, key: string) {
    if (key === "Backspace" && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }

  function handlePaste(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, length);
    if (digits.length === length) {
      onChange(digits.split(""));
      refs.current[length - 1]?.focus();
    }
  }

  return (
    <div
      className={cn("flex justify-center gap-2", className)}
      onPaste={(event) => {
        event.preventDefault();
        handlePaste(event.clipboardData.getData("text"));
      }}
    >
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[index] ?? ""}
          onChange={(event) => updateDigit(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event.key)}
          className="h-12 w-11 rounded-2xl border border-white/10 bg-black/25 text-center text-lg font-semibold text-zinc-50 outline-none transition focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[rgb(var(--ring)/0.25)]"
          aria-label={`Digit ${index + 1}`}
        />
      ))}
    </div>
  );
}
