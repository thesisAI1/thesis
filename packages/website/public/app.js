/* THESIS — live Faculty Room + transparency dashboard. Vanilla JS. */

const $ = (sel) => document.querySelector(sel);
const AGENTS = ["registrar", "auditor", "dean", "bursar", "endowment"];

/* ---------- helpers ---------- */

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}
function fmtEth(n) { return (Number(n) || 0).toFixed(4); }
function fmtPrice(n) { n = Number(n) || 0; return n === 0 ? "0" : n.toPrecision(3); }
function fmtPct(n) { n = Number(n) || 0; return (n >= 0 ? "+" : "") + n.toFixed(1) + "%"; }
function pnlClass(n) { return Number(n) >= 0 ? "pos" : "neg"; }
function shortAddr(a) { a = String(a || ""); return a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a; }
function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!t) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return Math.floor(s) + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function gradeBadge(g) { return g ? `<span class="badge grade-${esc(g)}">${esc(g)}</span>` : "—"; }
function bscToken(a) { return "https://basescan.org/token/" + encodeURIComponent(a); }
function bscAddr(a) { return "https://basescan.org/address/" + encodeURIComponent(a); }
function dexscreenerUrl(a) { return "https://dexscreener.com/base/" + encodeURIComponent(a); }
/** Tiny "view tweet" + "chart" icon-buttons for a position row. */
function rowLinks(postUrl, contractAddress) {
  const tweet = postUrl
    ? `<a class="row-icon" href="${esc(postUrl)}" target="_blank" rel="noopener noreferrer" title="View the original tweet">𝕏</a>`
    : "";
  const chart = `<a class="row-icon" href="${dexscreenerUrl(contractAddress)}" target="_blank" rel="noopener noreferrer" title="Open chart on DexScreener">📈</a>`;
  return `<span class="row-links">${tweet}${chart}</span>`;
}

/* ---------- live Faculty Room (SSE) ---------- */

let idleTimer = null;

function setAgent(agent, state) {
  const el = document.getElementById("agent-" + agent);
  if (!el) return;
  el.classList.remove("active", "done");
  if (state) el.classList.add(state);
}
function clearBody(agent) {
  const b = document.getElementById("body-" + agent);
  if (b) b.innerHTML = "";
}
function idleBody(agent, text) {
  const b = document.getElementById("body-" + agent);
  if (b) b.innerHTML = `<div class="agent-idle">${esc(text)}</div>`;
}
function appendLine(agent, text) {
  const b = document.getElementById("body-" + agent);
  if (!b) return;
  if (b.querySelector(".agent-idle")) b.innerHTML = "";
  const line = document.createElement("div");
  line.className = "line" + (/^verdict/i.test(text) ? " verdict" : "");
  line.textContent = text;
  b.appendChild(line);
}

function resetRoom() {
  setAgent("registrar", null); idleBody("registrar", "queued — awaiting review");
  setAgent("auditor", null); idleBody("auditor", "queued — awaiting review");
  setAgent("dean", null); idleBody("dean", "queued — awaiting the reports");
  setAgent("bursar", null); idleBody("bursar", "queued — awaiting a verdict");
  $("#verdict-banner").hidden = true;
}

function handleEvent(ev) {
  switch (ev.type) {
    case "review:start": {
      clearTimeout(idleTimer);
      resetRoom();
      const s = ev.submission || {};
      $("#submission-card").hidden = false;
      $("#sub-author").textContent = s.authorHandle || "@author";
      $("#sub-thesis").textContent = "“" + (s.thesisText || "") + "”";
      const ca = $("#sub-ca");
      ca.textContent = shortAddr(s.contractAddress);
      ca.href = bscToken(s.contractAddress || "");
      const copy = $("#sub-copy-ca");
      copy.dataset.ca = s.contractAddress || "";
      copy.textContent = "copy CA";
      const tweet = $("#sub-view-tweet");
      if (s.postUrl) {
        tweet.href = s.postUrl;
        tweet.style.display = "";
        // Belt-and-braces: some browsers ignore a click on an anchor that was
        // originally rendered without an href. Force the navigation by hand.
        tweet.onclick = (e) => {
          e.preventDefault();
          window.open(s.postUrl, "_blank", "noopener,noreferrer");
        };
      } else {
        tweet.removeAttribute("href");
        tweet.onclick = null;
        tweet.style.display = "none";
      }
      $("#room-activity").textContent =
        "Reviewing a thesis from " + (s.authorHandle || "an author") + "…";
      break;
    }
    case "agent:active":
      setAgent(ev.agent, "active");
      clearBody(ev.agent);
      break;
    case "agent:step":
      appendLine(ev.agent, ev.text);
      break;
    case "agent:done":
      setAgent(ev.agent, "done");
      break;
    case "review:verdict":
      showVerdict(ev);
      break;
    case "review:end":
      idleTimer = setTimeout(() => {
        $("#room-activity").textContent = "Watching X for new submissions…";
      }, 4500);
      setTimeout(refreshDashboard, 600);
      break;
    case "endowment":
      handleEndowment(ev);
      break;
  }
}

function showVerdict(ev) {
  const banner = $("#verdict-banner");
  const g = $("#verdict-grade");
  g.textContent = ev.grade;
  g.className = "verdict-grade grade-" + ev.grade;
  const buy = ev.decision === "BUY";
  $("#verdict-text").innerHTML = buy
    ? `<strong>Grade ${esc(ev.grade)} — FUND IT</strong>` +
      `<span class="vt-sub">The Bursar opens a ${((ev.positionSizePct || 0) * 100).toFixed(1)}% position</span>`
    : `<strong>Grade ${esc(ev.grade)} — SKIP</strong>` +
      `<span class="vt-sub">Only A and B grades are funded</span>`;
  banner.hidden = false;
  banner.style.animation = "none";
  void banner.offsetWidth;
  banner.style.animation = "";
}

function handleEndowment(ev) {
  setAgent("endowment", "active");
  clearBody("endowment");
  appendLine("endowment", "A position closed in profit — settling the books…");
  appendLine("endowment", `Realised profit: ${fmtEth(ev.totalProfitEth)} ETH`);
  appendLine(
    "endowment",
    `Splitting 25/25/25/25 — ${fmtEth(ev.toAuthorEth)} ETH to ${ev.authorHandle || "the author"}`,
  );
  appendLine(
    "endowment",
    ev.authorWallet
      ? "Verdict — author share sent to their wallet on Base"
      : "Verdict — author share escrowed; a payout request posted on X",
  );
  setTimeout(() => setAgent("endowment", "done"), 1200);
  setTimeout(refreshDashboard, 800);
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onopen = () => {
    $("#room-activity").textContent = "Watching X for new submissions…";
  };
  es.onmessage = (e) => {
    try { handleEvent(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  es.onerror = () => {
    $("#room-activity").textContent = "Reconnecting to the live stream…";
  };
}

/* ---------- dashboard ---------- */

async function refreshDashboard() {
  try { renderDashboard(await getJson("/api/dashboard")); }
  catch { $("#status-pill").innerHTML = "offline"; }
}

function renderDashboard(d) {
  const p = d.portfolio, r = d.reviews, di = d.distributions;
  $("#status-pill").innerHTML = `<span class="live-dot"></span> ${esc(d.mode)} mode`;

  const wl = $("#wallet-link");
  if (p.walletAddress) { wl.href = bscAddr(p.walletAddress); wl.hidden = false; }
  else wl.hidden = true;

  // Live timestamp pill — reveal once data has actually loaded once, then
  // tickLiveStatus() keeps the "updated Xs ago" copy fresh between refreshes.
  _lastDataFetchedAt = Date.now();
  $("#live-status").hidden = false;
  tickLiveStatus();

  $("#stat-grid").innerHTML = [
    portfolioValueCard(p),
    statCard("Realised PnL", fmtEth(p.realizedPnlEth) + " ETH", "since inception", pnlClass(p.realizedPnlEth), STAT_ICONS.pnl),
    statCard("Win rate", Math.round((p.winRate || 0) * 100) + "%", `${p.winCount} / ${p.closedCount} closed`, "", STAT_ICONS.winrate),
    statCard("Open positions", String(p.openCount), `${p.closedCount} closed`, "", STAT_ICONS.open),
  ].join("");

  // Activity strip — surfaces the single most recent close as a one-line
  // recap. d.closedPositions is sorted DESC by closedAt so [0] is the
  // freshest event we can show.
  renderActivityStrip((d.closedPositions || [])[0]);

  // Hero live-stats banner — three quick numbers under the CTA so first
  // impression includes real activity, not just copy. Re-renders on every
  // dashboard refresh; tickLiveStatus keeps the "updated Xs ago" copy
  // fresh in between.
  renderHeroStats(r, di);
  $("#stat-row").innerHTML = [
    mini(String(r.total), "theses reviewed"),
    mini(`${r.buys} / ${r.skips}`, "bought / skipped"),
    mini(fmtEth(di.toAuthors) + " ETH", "paid to authors"),
    mini(fmtEth(di.toBuyback) + " ETH", "$THESIS bought back & burned"),
  ].join("");

  const f = d.funnel || {};
  $("#funnel-line").innerHTML =
    `Triage funnel —  <b>${f.seen || 0}</b> mentions seen  ·  ` +
    `<b>${f.passed || 0}</b> passed the filters  ·  ` +
    `<b>${f.reviewed || 0}</b> fully reviewed  ·  ` +
    `<b>${f.queued || 0}</b> waiting in the queue`;

  renderOpen(d.openPositions || []);
  renderClosed(d.closedPositions || []);
  renderFeed(d.recentReviews || []);
  renderDist(di);
}

/** Inline-SVG icon set used by the Live Performance stat cards. Kept as
 *  small outline glyphs (~14px) so they read as quiet metadata next to the
 *  label, not as decoration. Color is set via currentColor so the .stat-icon
 *  CSS class controls the tint (hero card gets accent, others get muted). */
const STAT_ICONS = {
  portfolio:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  pnl:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  winrate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M9 16l-1.5 6 4.5-3 4.5 3-1.5-6"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
};

function statCard(label, value, sub, vc, icon) {
  const head = `<div class="stat-head">${icon ? `<span class="stat-icon">${icon}</span>` : ""}<span class="stat-label">${esc(label)}</span></div>`;
  return `<div class="stat-card">${head}
    <div class="stat-value ${vc || ""}">${esc(value)}</div>
    <div class="stat-sub">${esc(sub)}</div></div>`;
}

/**
 * Portfolio value stat card — bespoke because it needs to combine wallet
 * ETH balance + the live ETH value of every open position to communicate
 * the REAL money under management. The old version showed only the wallet
 * balance which under-sold things badly when a lot was tied up in open
 * positions.
 *
 * Main number is USD when we have an ETH/USD rate, ETH otherwise (the very
 * first request after a process restart may land before the rate is cached).
 * Sub-line always breaks down "wallet + N open" so visitors can see the mix.
 */
function portfolioValueCard(p) {
  const totalEth = Number(p.totalPortfolioValueEth) || Number(p.balanceEth) || 0;
  const totalUsd = Number(p.totalPortfolioValueUsd) || 0;
  const walletEth = Number(p.balanceEth) || 0;
  const openValueEth = Number(p.openPositionsValueEth) || 0;
  const openCount = Number(p.openCount) || 0;
  // Main figure: USD when known, fall back to ETH on the cold-start tick.
  const mainValue = totalUsd > 0 ? fmtUsd(totalUsd) : fmtEth(totalEth) + " ETH";
  // Sub-line: ETH total + breakdown. Reads naturally as a sentence.
  const ethTotalStr = fmtEth(totalEth) + " Ξ";
  const breakdown =
    openCount > 0
      ? `wallet ${fmtEth(walletEth)} + ${fmtEth(openValueEth)} in ${openCount} open`
      : `wallet only — no open positions`;
  const subLine = totalUsd > 0 ? `${ethTotalStr} · ${breakdown}` : breakdown;
  // is-hero CSS class gets the richer gradient + larger hero number — visually
  // anchors the row so visitors register the headline figure first.
  return (
    `<div class="stat-card is-hero">` +
    `<div class="stat-head"><span class="stat-icon">${STAT_ICONS.portfolio}</span><span class="stat-label">Portfolio value</span></div>` +
    `<div class="stat-value">${esc(mainValue)}</div>` +
    `<div class="stat-sub">${esc(subLine)}</div>` +
    `</div>`
  );
}

/** Format a USD amount as "$X,XXX" — drops cents above $100 (signal-only),
 *  keeps them below so a $4.20 author payout doesn't round to "$4". */
function fmtUsd(n) {
  if (!isFinite(n) || n === 0) return "$0";
  const abs = Math.abs(n);
  if (abs >= 100) return "$" + Math.round(n).toLocaleString("en-US");
  return "$" + n.toFixed(2);
}
function mini(value, label) {
  return `<div class="mini"><div class="mini-value">${esc(value)}</div>
    <div class="mini-label">${esc(label)}</div></div>`;
}

function renderOpen(rows) {
  $("#open-count").textContent = rows.length;
  $("#open-empty").hidden = rows.length > 0;
  $("#open-rows").innerHTML = rows
    .map((o) => {
      return `<tr>
    <td>${tokenCell(o.tokenSymbol, o.contractAddress)}</td>
    <td>${authorCell(o)}</td>
    <td>${gradeBadge(o.grade)}</td>
    <td>${tierProgressCell(o)}</td>
    <td class="num">${fmtEth(o.amountInEth)}</td>
    <td class="num">${mcapCell(o.marketCapAtEntryUsd, o.marketCapNowUsd)}</td>
    <td class="num ${pnlClass(o.unrealizedPnlEth)}">${fmtEth(o.unrealizedPnlEth)} (${fmtPct(o.unrealizedPct)})</td></tr>`;
    })
    .join("");
}

/**
 * Render the tier-progress widget that replaces the old "X/4 TP" text.
 *
 * Draws one bar segment per take-profit tier. A segment is:
 *   - "filled green"  if that tier has already been hit (sold)
 *   - "partial gold"  if it's the next tier — the fill width is how close
 *                     the price is to the next target, measured as a
 *                     percentage of the distance from the previous threshold
 *                     to the next one (e.g. at +165% with TP1 at +100% and
 *                     TP2 at +200%, fill = (165-100)/(200-100) = 65%)
 *   - "empty grey"    if it's a future tier
 *
 * Below the bars we print a tiny caption: left = what's been hit (or the
 * current gain if no tier yet), right = what's next. When everything is hit,
 * the right side becomes "trailing stop" since that's all that holds the
 * position open after the final TP.
 */
function tierProgressCell(o) {
  const tiersHit = Number(o.tiersHit) || 0;
  const targets = Array.isArray(o.tierTargets) ? o.tierTargets : [];
  const tierCount = targets.length || Number(o.tierCount) || 0;
  // Defensive: if the API ever ships a position with no tier targets, fall
  // back to the old "1/4 TP" text rather than rendering an empty cell.
  if (tierCount === 0) {
    return `<div class="tp-cell"><span class="tp-fallback">${esc(tiersHit + "/" + (o.tierCount || 0) + " TP")}</span></div>`;
  }
  const gainPct = Number(o.unrealizedPct);
  const segments = [];
  for (let i = 0; i < tierCount; i++) {
    if (i < tiersHit) {
      segments.push('<div class="tp-seg tp-hit"></div>');
    } else if (i === tiersHit) {
      // Current tier — compute fill toward the next target.
      const prev = i > 0 ? targets[i - 1].gainPct : 0;
      const next = targets[i].gainPct;
      let fillPct = 0;
      if (isFinite(gainPct) && next > prev) {
        fillPct = ((gainPct - prev) / (next - prev)) * 100;
        if (fillPct < 0) fillPct = 0;
        if (fillPct > 100) fillPct = 100;
      }
      segments.push(
        `<div class="tp-seg tp-current"><div class="tp-fill" style="width:${fillPct.toFixed(0)}%"></div></div>`,
      );
    } else {
      segments.push('<div class="tp-seg tp-future"></div>');
    }
  }
  // Bottom captions.
  let left, right;
  if (tiersHit === 0) {
    left = isFinite(gainPct) ? fmtSignedPct(gainPct) : "—";
    right = `&rarr; TP1 +${targets[0].gainPct}%`;
  } else if (tiersHit >= tierCount) {
    left = `<span class="tp-good">All TPs hit</span>`;
    right = `trailing stop`;
  } else {
    const lastHit = targets[tiersHit - 1].gainPct;
    left = `<span class="tp-good">TP${tiersHit} &middot; +${lastHit}%</span>`;
    right = `&rarr; TP${tiersHit + 1} +${targets[tiersHit].gainPct}%`;
  }
  return (
    `<div class="tp-cell">` +
    `<div class="tp-bar">${segments.join("")}</div>` +
    `<div class="tp-caption"><span>${left}</span><span class="tp-dim">${right}</span></div>` +
    `</div>`
  );
}

/** Compact signed-percent formatter for the tier progress caption — keeps one
 *  decimal under 10, drops it once we're well into multi-digit territory. */
function fmtSignedPct(n) {
  if (!isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  const abs = Math.abs(n);
  return `${sign}${abs < 10 ? n.toFixed(1) : Math.round(n)}%`;
}

/** Render the token cell: $TICKER link to DexScreener + copy-CA icon button. */
function tokenCell(symbol, address) {
  const label = symbol ? "$" + symbol : shortAddr(address);
  const dexUrl = dexscreenerUrl(address);
  const addrAttr = esc(address);
  // Material Icons "content_copy" — single fill path, the most widely
  // compatible inline SVG copy icon. Same shape as DexScreener uses.
  const copyIcon =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>' +
    '</svg>';
  return (
    `<div class="tok-cell">` +
    `<a class="tok" href="${dexUrl}" target="_blank" rel="noopener noreferrer" title="${addrAttr}">${esc(label)}</a>` +
    `<button class="tok-copy" type="button" data-copy="${addrAttr}" onclick="copyCA(this)" title="Copy contract address" aria-label="Copy contract address">${copyIcon}</button>` +
    `</div>`
  );
}

/** Copy a contract address to the clipboard with a brief visual confirmation. */
window.copyCA = function (btn) {
  const value = btn.getAttribute("data-copy") || "";
  const finish = () => {
    btn.classList.add("copied");
    setTimeout(() => btn.classList.remove("copied"), 1300);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(finish).catch(finish);
  } else {
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) { /* swallow */ }
    document.body.removeChild(ta);
    finish();
  }
};

/** Render the avatar + handle + "view thesis" cell. Whole block links to the X post. */
function authorCell(o) {
  const handle = esc(o.authorHandle || "@author");
  const initials = (o.authorHandle || "?").replace(/^@/, "").slice(0, 2).toUpperCase();
  const avatar = o.authorAvatarUrl
    ? `<img class="ac-avatar" src="${esc(o.authorAvatarUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ac-avatar ac-fallback',textContent:'${esc(initials)}'}))" />`
    : `<div class="ac-avatar ac-fallback">${esc(initials)}</div>`;
  const inner = `${avatar}<div class="ac-meta"><span class="ac-handle">${handle}</span><span class="ac-view">VIEW THESIS &#x2197;</span></div>`;
  return o.postUrl
    ? `<a class="ac" href="${esc(o.postUrl)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="ac">${inner}</div>`;
}

/** Render entry → now market cap with coloured delta. */
function mcapCell(entry, now) {
  if (entry == null && now == null) return '<span class="mc-na">—</span>';
  if (entry == null) return `<div class="mc"><span class="mc-now">${fmtMcap(now)}</span></div>`;
  if (now == null) return `<div class="mc"><span class="mc-entry">${fmtMcap(entry)}</span></div>`;
  const pct = entry > 0 ? ((now - entry) / entry) * 100 : 0;
  const dir = pct >= 0 ? "up" : "down";
  const sign = pct >= 0 ? "+" : "";
  return `<div class="mc"><span class="mc-entry">${fmtMcap(entry)}</span><span class="mc-now ${dir}">${fmtMcap(now)} (${sign}${pct.toFixed(1)}%)</span></div>`;
}

function fmtMcap(usd) {
  if (usd == null || !isFinite(usd)) return "—";
  if (usd >= 1_000_000) return "$" + (usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 2) + "M";
  if (usd >= 1_000) return "$" + Math.round(usd / 1_000) + "K";
  return "$" + Math.round(usd);
}
function renderClosed(rows) {
  $("#closed-count").textContent = rows.length;
  $("#closed-empty").hidden = rows.length > 0;
  $("#closed-rows").innerHTML = rows.map((c) => `<tr>
    <td>${tokenCell(c.tokenSymbol, c.contractAddress)}</td>
    <td>${esc(c.authorHandle)}</td>
    <td class="num">${fmtEth(c.amountInEth)}</td>
    <td class="num">${esc(fmtPrice(c.entryPriceEth))}</td>
    <td class="num">${esc(fmtPrice(c.exitPriceEth))}</td>
    <td class="num ${pnlClass(c.realisedPnlEth)}">${fmtEth(c.realisedPnlEth)} (${fmtPct(c.realisedPct)})</td>
    <td>${esc(timeAgo(c.closedAt))}</td></tr>`).join("");
}
function renderFeed(rows) {
  $("#feed-empty").hidden = rows.length > 0;
  $("#feed").innerHTML = rows.map((v) => `<div class="feed-item">
    <div class="feed-top">
      <span class="feed-handle">${esc(v.authorHandle)}</span>
      <a class="tok" href="${bscToken(v.contractAddress)}" target="_blank" rel="noopener">${esc(shortAddr(v.contractAddress))}</a>
      <span class="feed-scores">Registrar ${esc(v.authorScore)} · Auditor ${esc(v.tokenScore)}</span>
      ${gradeBadge(v.grade)}
      <span class="badge ${v.decision === "BUY" ? "buy" : "skip"}">${esc(v.decision)}</span>
      <span class="feed-time">${esc(timeAgo(v.reviewedAt))}</span>
    </div>
    <div class="feed-rationale">${esc(v.rationale)}</div>
    ${v.skippedReason ? `<div class="feed-skip">Approved, but not bought — ${esc(v.skippedReason)}</div>` : ""}
  </div>`).join("");
}
function renderDist(di) {
  const cards = [
    ["25%", "#4F9DDE", fmtEth(di.toAuthors), "To authors"],
    ["25%", "#3FB984", fmtEth(di.toPortfolio), "To trading portfolio"],
    ["25%", "#8593AA", fmtEth(di.toTeam), "To team / running costs"],
    ["25%", "#E0653E", fmtEth(di.toBuyback), "$THESIS buyback & burn"],
  ];
  $("#dist-grid").innerHTML = cards.map(([pct, c, val, label]) => `<div class="dist-card" style="--c:${c}">
    <div class="dist-pct">${pct}</div><div class="dist-value">${val} ETH</div>
    <div class="dist-label">${esc(label)}</div></div>`).join("");
}

/** Render the activity strip beneath the stat cards. Takes the freshest
 *  closed position (sorted DESC by closedAt on the API side) and turns it
 *  into a one-line recap that links to the close-announcement tweet on X.
 *
 *  Hides itself when the trade log is empty or the latest entry has no
 *  postUrl to link to — the strip is a "click to read more" surface and
 *  serves no purpose without a destination. */
function renderActivityStrip(latest) {
  const strip = $("#activity-strip");
  if (!strip) return;
  if (!latest || !latest.postUrl) {
    strip.hidden = true;
    strip.removeAttribute("href");
    strip.innerHTML = "";
    return;
  }
  const pnl = Number(latest.realisedPnlEth) || 0;
  const amountClass = pnl >= 0 ? "act-amount" : "act-amount neg";
  const sign = pnl >= 0 ? "+" : "";
  const ticker = latest.tokenSymbol
    ? "$" + esc(latest.tokenSymbol)
    : esc(shortAddr(latest.contractAddress));
  strip.hidden = false;
  strip.href = latest.postUrl;
  strip.innerHTML =
    `<span class="act-when">${esc(timeAgo(latest.closedAt))}</span>` +
    `<span class="act-verb">Closed</span>` +
    `<span class="act-token">${ticker}</span>` +
    `<span class="${amountClass}">${sign}${fmtEth(pnl)} Ξ</span>` +
    `<span class="act-tail">for <span class="act-handle">${esc(latest.authorHandle || "")}</span></span>` +
    `<span class="act-arrow">→</span>`;
}

/** Track when the dashboard payload last landed; tickLiveStatus reads this
 *  every second to keep the "updated Xs ago" pill copy current between the
 *  20s refresh cycles. */
let _lastDataFetchedAt = 0;
function tickLiveStatus() {
  if (!_lastDataFetchedAt) return;
  const secs = Math.floor((Date.now() - _lastDataFetchedAt) / 1000);
  let text;
  if (secs < 5) text = "just now";
  else if (secs < 60) text = `${secs}s ago`;
  else if (secs < 3600) text = `${Math.floor(secs / 60)}m ago`;
  else text = `${Math.floor(secs / 3600)}h ago`;
  // Same timestamp drives two pills (Live Performance section + hero banner).
  const a = $("#live-status-time");
  if (a) a.textContent = text;
  const b = $("#hero-stat-time-val");
  if (b) b.textContent = text;
}

/** Fill the three quick numbers in the hero banner (funded count, paid to
 *  authors, $THESIS buyback ETH). Reveals the banner once data lands —
 *  hidden until then so the hero doesn't flash an empty card on cold load. */
function renderHeroStats(reviews, distributions) {
  const wrap = $("#hero-stats");
  if (!wrap) return;
  const funded = Number(reviews && reviews.buys) || 0;
  const paidEth = Number(distributions && distributions.toAuthors) || 0;
  const buybackEth = Number(distributions && distributions.toBuyback) || 0;
  const elFunded = $("#hero-funded");
  const elPaid = $("#hero-paid");
  const elBurned = $("#hero-burned");
  if (elFunded) elFunded.textContent = `${funded} ${funded === 1 ? "thesis" : "theses"}`;
  if (elPaid) elPaid.textContent = `${fmtEth(paidEth)} Ξ`;
  if (elBurned) elBurned.textContent = `${fmtEth(buybackEth)} Ξ`;
  wrap.hidden = false;
}

/* ---------- init ---------- */

document.getElementById("sub-copy-ca")?.addEventListener("click", function () {
  const ca = this.dataset.ca;
  if (!ca) return;
  navigator.clipboard.writeText(ca).then(() => {
    this.textContent = "✓ copied";
    setTimeout(() => { this.textContent = "copy CA"; }, 1500);
  });
});

connectStream();
refreshDashboard();
setInterval(refreshDashboard, 20000);
setInterval(tickLiveStatus, 1000);
