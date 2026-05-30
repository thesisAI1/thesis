"use client";

/**
 * Renders a number that counts up from 0 to `value` when it scrolls into view
 * (design's [data-count]). Inline <span> so it drops into any stat readout.
 */
import { useCountUp } from "./useCountUp";

export interface CountUpProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  group?: boolean;
  className?: string;
}

export function CountUp({ value, decimals, prefix, suffix, group, className }: CountUpProps) {
  const { ref, text } = useCountUp<HTMLSpanElement>({
    target: value,
    decimals,
    prefix,
    suffix,
    group,
  });
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
