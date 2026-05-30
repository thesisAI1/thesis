/**
 * Section header (design `.sec-head`): an amber mono index, a bold title, an
 * optional trailing mono meta note, and a bottom hairline rule.
 */
import type { ReactNode } from "react";

export interface SectionHeadProps {
  /** Two-digit section index, e.g. "01". */
  index: string;
  title: ReactNode;
  meta?: ReactNode;
}

export function SectionHead({ index, title, meta }: SectionHeadProps) {
  return (
    <div className="mb-[22px] mt-[18px] flex items-center gap-3 border-b border-border pb-[13px]">
      <span className="font-mono text-[11px] tracking-[1px] text-accent">{index}</span>
      <span className="text-[23px] font-extrabold tracking-[-0.4px]">{title}</span>
      {meta ? (
        <span className="ml-auto font-mono text-[11px] tracking-[0.6px] text-dim">{meta}</span>
      ) : null}
    </div>
  );
}
