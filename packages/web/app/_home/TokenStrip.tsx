/**
 * $THESIS token section — a compact ticker + supply-burn tagline card, then the
 * live DexScreener depth embed with the contract address and the "Open on
 * DexScreener" link tucked directly beneath the chart. The CA matches the shell
 * footer's THESIS_CA; copy uses the shared CopyButton.
 */
import { CopyButton } from "@/components/shell/CopyButton";
import { Reveal } from "./Reveal";

const THESIS_CA = "0x36e807119529E44d6F36aD5CE24AeB87a4529ba3";
const DEXSCREENER_URL = `https://dexscreener.com/base/${THESIS_CA}`;
const EMBED_URL = `${DEXSCREENER_URL}?embed=1&theme=dark&trades=0&info=0`;

const TOP_EDGE =
  "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)] before:content-['']";

export function TokenStrip() {
  return (
    <>
      {/* compact ticker + supply-burn tagline */}
      <div
        className={`relative overflow-hidden rounded-lg border border-border bg-[linear-gradient(180deg,#131825_0%,#0e1219_100%)] px-6 py-[18px] ${TOP_EDGE}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-[12px] gap-y-1">
          <span className="font-serif text-[20px] font-bold text-accent">$THESIS</span>
          <span className="font-mono text-[10px] uppercase tracking-[1.6px] text-dim">
            PROJECT TOKEN · BANKR LAUNCH · BASE
          </span>
        </div>
        <p className="mt-1.5 max-w-[66ch] text-[12.5px] leading-[1.55] text-muted">
          Every winning trade buys back $THESIS on the open market and burns it. Every committee win
          permanently shrinks the supply.
        </p>
      </div>

      {/* live chart, with the CA + DexScreener link directly beneath it */}
      <Reveal className="mt-[14px]">
        <div className="relative overflow-hidden rounded-lg border border-border bg-panel">
          <iframe
            src={EMBED_URL}
            title="$THESIS live chart"
            loading="lazy"
            className="block h-[480px] w-full border-0 bg-panel"
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-[13px]">
            <div className="flex min-w-0 max-w-full items-center gap-[10px] rounded-[9px] border border-border bg-[#080b11] py-2 pl-[13px] pr-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[1.2px] text-dim">CA</span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-text">
                {THESIS_CA}
              </span>
              <CopyButton value={THESIS_CA} label="copy" title="Copy contract address" />
            </div>
            <a
              href={DEXSCREENER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-[9px] rounded-md border border-border-2 bg-panel-2 px-[15px] py-2 text-[12.5px] font-semibold text-text transition-colors hover:border-border-hi"
            >
              Open on DexScreener ↗
            </a>
          </div>
          <div className="border-t border-border px-4 py-[11px] font-mono text-[11px] text-dim">
            Live chart from DexScreener. If it&apos;s blocked in this preview,{" "}
            <a href={DEXSCREENER_URL} target="_blank" rel="noopener noreferrer" className="text-blue">
              open it on DexScreener ↗
            </a>
            .
          </div>
        </div>
      </Reveal>
    </>
  );
}
