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

  $("#stat-grid").innerHTML = [
    statCard("Portfolio value", fmtEth(p.balanceEth) + " ETH", "trading wallet balance"),
    statCard("Realised PnL", fmtEth(p.realizedPnlEth) + " ETH", "since inception", pnlClass(p.realizedPnlEth)),
    statCard("Win rate", Math.round((p.winRate || 0) * 100) + "%", `${p.winCount} / ${p.closedCount} closed`),
    statCard("Open positions", String(p.openCount), `${p.closedCount} closed`),
  ].join("");
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

function statCard(label, value, sub, vc) {
  return `<div class="stat-card"><div class="stat-label">${esc(label)}</div>
    <div class="stat-value ${vc || ""}">${esc(value)}</div>
    <div class="stat-sub">${esc(sub)}</div></div>`;
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
      const stage = `${o.tiersHit}/${o.tierCount} TP`;
      return `<tr>
    <td><a class="tok" href="${bscToken(o.contractAddress)}" target="_blank" rel="noopener" title="${esc(o.contractAddress)}">${esc(o.tokenSymbol ? "$" + o.tokenSymbol : shortAddr(o.contractAddress))}</a></td>
    <td>${esc(o.authorHandle)}</td><td>${gradeBadge(o.grade)}</td>
    <td>${esc(stage)}</td>
    <td class="num">${fmtEth(o.amountInEth)}</td>
    <td class="num">${esc(fmtPrice(o.currentPriceEth))}</td>
    <td class="num ${pnlClass(o.unrealizedPnlEth)}">${fmtEth(o.unrealizedPnlEth)} (${fmtPct(o.unrealizedPct)})</td>
    <td class="num ${pnlClass(o.realisedPnlEth)}">${fmtEth(o.realisedPnlEth)}</td>
    <td>${rowLinks(o.postUrl, o.contractAddress)}</td></tr>`;
    })
    .join("");
}
function renderClosed(rows) {
  $("#closed-count").textContent = rows.length;
  $("#closed-empty").hidden = rows.length > 0;
  $("#closed-rows").innerHTML = rows.map((c) => `<tr>
    <td><a class="tok" href="${bscToken(c.contractAddress)}" target="_blank" rel="noopener" title="${esc(c.contractAddress)}">${esc(c.tokenSymbol ? "$" + c.tokenSymbol : shortAddr(c.contractAddress))}</a></td>
    <td>${esc(c.authorHandle)}</td>
    <td class="num">${fmtEth(c.amountInEth)}</td>
    <td class="num">${esc(fmtPrice(c.entryPriceEth))}</td>
    <td class="num">${esc(fmtPrice(c.exitPriceEth))}</td>
    <td class="num ${pnlClass(c.realisedPnlEth)}">${fmtEth(c.realisedPnlEth)} (${fmtPct(c.realisedPct)})</td>
    <td>${esc(timeAgo(c.closedAt))}</td>
    <td>${rowLinks(c.postUrl, c.contractAddress)}</td></tr>`).join("");
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
