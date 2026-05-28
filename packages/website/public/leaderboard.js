(function () {
  const PODIUM_CLASSES = ["gold", "silver", "bronze"];

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fmtEth(n) { return (n >= 0 ? "+" : "") + Number(n).toFixed(4); }
  function fmtPct(n) { return (n >= 0 ? "+" : "") + Number(n).toFixed(0) + "%"; }
  function xProfile(handle) {
    const h = handle.startsWith("@") ? handle.slice(1) : handle;
    return "https://x.com/" + encodeURIComponent(h);
  }

  /** Render an X profile avatar at the given size. Falls back to a circular
   *  initials monogram when no avatar URL is on file (pre-redesign authors). */
  function avatarHtml(row, size) {
    const initials = String(row.authorHandle || "?").replace(/^@/, "").slice(0, 2).toUpperCase();
    const style = "width:" + size + "px;height:" + size + "px";
    if (row.authorAvatarUrl) {
      return (
        '<img class="lb-avatar" src="' + esc(row.authorAvatarUrl) +
        '" alt="" referrerpolicy="no-referrer" style="' + style +
        '" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'lb-avatar lb-avatar-fallback\',textContent:\'' + esc(initials) + '\',style:\'' + style + '\'}))" />'
      );
    }
    return '<div class="lb-avatar lb-avatar-fallback" style="' + style + '">' + esc(initials) + '</div>';
  }

  function renderPodium(rows) {
    const top3 = rows.slice(0, 3);
    // Visual order: silver (2nd), gold (1st), bronze (3rd) — gold in the middle.
    const order = [top3[1], top3[0], top3[2]];
    const labels = ["2ND", "1ST", "3RD"];
    const classes = ["silver", "gold", "bronze"];

    $("#podium").innerHTML = order.map((r, i) => {
      if (!r) return `<div class="podium-card ${classes[i]}" style="visibility:hidden"></div>`;
      const avatarSize = classes[i] === "gold" ? 64 : 56;
      return `
        <div class="podium-card ${classes[i]}">
          <span class="podium-rank">${labels[i]}</span>
          <div class="podium-num">RANK ${String(r.rank).padStart(2, "0")}</div>
          <div class="podium-avatar">${avatarHtml(r, avatarSize)}</div>
          <div class="podium-handle">
            <a class="lb-handle" href="${xProfile(r.authorHandle)}" target="_blank" rel="noopener noreferrer">${esc(r.authorHandle)}</a>
          </div>
          <div class="podium-earned">${fmtEth(r.totalEarnedEth)} ETH</div>
          <div class="podium-sub">${r.funded} funded · ${r.wins} ${r.wins === 1 ? "win" : "wins"}${r.closed > 0 ? " · " + Math.round(r.winRate * 100) + "% win rate" : ""}</div>
        </div>`;
    }).join("");
  }

  function renderTable(rows) {
    const tbody = $("#lb-rows");
    const empty = $("#lb-empty");
    if (!rows.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td><span class="rank ${r.rank <= 3 ? "rank-top" : ""}">${String(r.rank).padStart(2, "0")}</span></td>
        <td>
          <a class="lb-author" href="${xProfile(r.authorHandle)}" target="_blank" rel="noopener noreferrer">
            ${avatarHtml(r, 28)}
            <span class="lb-handle">${esc(r.authorHandle)}</span>
          </a>
        </td>
        <td class="num">${r.funded}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.closed > 0 ? Math.round(r.winRate * 100) + "%" : "—"}</td>
        <td class="num" style="color:${r.totalEarnedEth > 0 ? "var(--green)" : "var(--muted)"}">${fmtEth(r.totalEarnedEth)} ETH</td>
        <td class="num" style="color:var(--muted)">${r.bestTradePct > 0 ? fmtPct(r.bestTradePct) : "—"}</td>
      </tr>`).join("");
  }

  async function load() {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      const data = await res.json();
      const rows = data.leaderboard || [];
      renderPodium(rows);
      renderTable(rows);
    } catch (err) {
      console.error("leaderboard fetch failed", err);
      $("#lb-empty").textContent = "Couldn't load the leaderboard right now. Try again in a moment.";
      $("#lb-empty").hidden = false;
    }
  }

  load();
  // Refresh every 60s so closed positions land on the board without a manual reload.
  setInterval(load, 60_000);
})();
