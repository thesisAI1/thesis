/**
 * Wallet balances bento cell — the agent's native balance on EACH chain
 * (ETH on Base, SOL on Solana) shown separately, plus the combined total in
 * USD. Native amounts are never summed (different coins); only `combinedTotalUsd`
 * (wallet + open positions, per chain, in USD) is a cross-chain figure.
 */
import type { ChainBalance, PortfolioSummary } from "@/lib/api";
import { nativeSymbol } from "@/lib/chain";
import { fmtUsd } from "./format";
import { WalletIcon } from "./icons";
import styles from "./dashboard.module.css";

/** Block-explorer address URL per chain (BaseScan / Solscan). */
function explorerAddress(chain: ChainBalance["chain"], address: string): string {
  return chain === "solana"
    ? `https://solscan.io/account/${encodeURIComponent(address)}`
    : `https://basescan.org/address/${encodeURIComponent(address)}`;
}

function chainLabel(chain: ChainBalance["chain"]): string {
  return chain === "solana" ? "Solana" : "Base";
}

export function ChainBalancesCard({ portfolio }: { portfolio: PortfolioSummary }) {
  const { chainBalances, combinedTotalUsd } = portfolio;
  return (
    <div className={`${styles.kpi} ${styles.balancesCard}`}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiIco}>
          <WalletIcon />
        </span>
        <span className={styles.kpiL}>Wallet balances</span>
      </div>

      <div className={styles.balancesRows}>
        {chainBalances.map((b) => {
          const native = `${b.native.toFixed(4)} ${nativeSymbol(b.chain)}`;
          return (
            <div key={b.chain} className={styles.balancesRow}>
              <span className={styles.balancesChain}>
                {b.address ? (
                  <a
                    className={styles.walletLink}
                    href={explorerAddress(b.chain, b.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${chainLabel(b.chain)} wallet on explorer`}
                  >
                    {chainLabel(b.chain)} ↗
                  </a>
                ) : (
                  chainLabel(b.chain)
                )}
              </span>
              <span className={styles.balancesNative}>{native}</span>
              <span className={styles.balancesUsd}>{b.walletUsd > 0 ? fmtUsd(b.walletUsd) : "—"}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.balancesTotal}>
        <span className={styles.kpiL}>Total</span>
        <span className={styles.balancesTotalV}>
          {combinedTotalUsd > 0 ? fmtUsd(combinedTotalUsd) : "—"}
        </span>
      </div>
      <div className={styles.kpiN}>wallet + open positions · both chains</div>
    </div>
  );
}
