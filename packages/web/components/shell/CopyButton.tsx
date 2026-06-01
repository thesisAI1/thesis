"use client";

/**
 * Copy-to-clipboard button (design `.tok-copy` / `.token-ca .copy`). Copies the
 * given value, then shows a transient "copied" state. Uses the Material
 * content_copy glyph by default; pass `label` to show text instead.
 */
import { useEffect, useRef, useState } from "react";
import { CopyIcon } from "./icons";

export interface CopyButtonProps {
  /** The string to copy (e.g. a contract address). */
  value: string;
  /** Optional text label instead of the icon glyph. */
  label?: string;
  /** Accessible label when rendering the icon-only variant. */
  title?: string;
  className?: string;
}

const RESET_MS = 1400;

export function CopyButton({
  value,
  label,
  title = "Copy",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      return; // clipboard blocked (insecure context / denied) — no-op
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), RESET_MS);
  };

  const base =
    "inline-flex items-center justify-center gap-1 cursor-pointer rounded-xs border border-border-2 bg-panel font-mono text-muted transition-colors hover:text-accent hover:border-accent";
  const copiedCls = copied ? "text-green border-green hover:text-green hover:border-green" : "";

  if (label) {
    return (
      <button
        type="button"
        onClick={onCopy}
        aria-label={title}
        className={`${base} px-[11px] py-[5px] text-[10.5px] ${copiedCls}${className ? ` ${className}` : ""}`}
      >
        {copied ? "✓ copied" : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : title}
      className={`${base} h-6 w-6 p-0 ${copiedCls}${className ? ` ${className}` : ""}`}
    >
      {copied ? (
        <span className="text-[12px] leading-none">✓</span>
      ) : (
        <CopyIcon width={14} height={14} />
      )}
    </button>
  );
}
