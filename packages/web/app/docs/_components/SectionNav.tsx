"use client";

/**
 * Sticky documentation TOC (design `.toc`). A mono "Documentation" header above
 * a column of anchor links, each on a left hairline. Scroll-spy highlights the
 * section currently in view by observing every `<section>` the links point to.
 */
import { useEffect, useState } from "react";

/** One entry in the table of contents: the section `id` and its label. */
export interface NavSection {
  id: string;
  label: string;
}

export interface SectionNavProps {
  sections: NavSection[];
}

export function SectionNav({ sections }: SectionNavProps) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Bias the active band toward the top of the viewport so a section
      // becomes "current" as its heading reaches the sticky nav line.
      { rootMargin: "-80px 0px -65% 0px", threshold: 0 },
    );

    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <aside className="sticky top-[84px] hidden self-start pt-12 md:block">
      <div className="mb-[14px] font-mono text-[10px] uppercase tracking-[1.6px] text-dim">
        Documentation
      </div>
      {sections.map((section) => {
        const isActive = section.id === active;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={isActive ? "true" : undefined}
            className={`block border-l py-[6px] pl-[14px] text-[13.5px] transition-colors ${
              isActive
                ? "border-accent text-accent"
                : "border-border text-muted hover:border-border-hi hover:text-text"
            }`}
          >
            {section.label}
          </a>
        );
      })}
    </aside>
  );
}
