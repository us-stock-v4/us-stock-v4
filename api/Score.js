// GET /api/score?symbol=IOT -> { symbol, price, changePercent, total, scores, detail, analysis }
// 權重：營收 30% + EPS 30% + 未反映 20% + 技術 20%
// Vercel Serverless Function. 需要環境變數 FINNHUB_API_KEY
const KEY = process.env.FINNHUB_API_KEY;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

async function j(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} failed ${r.status}`);
  return r.json();
}

function rsi14(closes) {
  if (!closes || closes.length < 15) return null;
  let g = 0, l = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  const sym = String(req.query.symbol || "").trim().toUpperCase();
  if (!sym) return res.status(400).json({ error: "missing symbol" });
  if (!KEY) return res.status(500).json({ error: "FINNHUB_API_KEY not set in Vercel env" });
  try {
    const now = Math.floor(Date.now() / 1000);
    const enc = encodeURIComponent(sym);

    const [earn, candle, quote] = await Promise.all([
      j(`https://finnhub.io/api/v1/stock/earnings?symbol=${enc}&token=${KEY}`),
      j(`https://finnhub.io/api/v1/stock/candle?symbol=${enc}&resolution=D&from=${now - 150 * 86400}&to=${now}&token=${KEY}`),
      j(`https://finnhub.io/api/v1/quote?symbol=${enc}&token=${KEY}`).catch(()=>null)
    ]);

    // EPS 超預期
    let epsSur = null, earnDate = null;
    if (Array.isArray(earn) && earn.length) {
      const e = earn[0];
      earnDate = e.period || null;
      if (e.actual != null && e.estimate) epsSur = (e.actual - e.estimate) / Math.abs(e.estimate) * 100;
    }

    // 營收年增
    let revSur = null;
    try {
      const m = await j(`https://finnhub.io/api/v1/stock/metric?symbol=${enc}&metric=all&token=${KEY}`);
      if (m && m.metric && m.metric.revenueGrowthQuarterlyYoy != null) {
        revSur = m.metric.revenueGrowthQuarterlyYoy * 100;
      }
    } catch(e) {}

    // RSI + price from candle
    let rsi = null;
    let lastClose = null;
    let prevClose = null;
    if (candle && candle.s === "ok" && Array.isArray(candle.c) && candle.c.length) {
      rsi = rsi14(candle.c);
      lastClose = candle.c[candle.c.length-1];
      prevClose = candle.c.length>1 ? candle.c[candle.c.length-2] : null;
    }

    // 即時價格優先用 quote
    let price = null;
    let changePercent = null;
    if (quote && quote.c) {
      price = quote.c;
      changePercent = quote.dp; // Finnhub dp = change percent
      if (quote.pc) prevClose = quote.pc;
    } else if (lastClose != null && prevClose) {
      price = lastClose;
      changePercent = ((lastClose - prevClose)/prevClose)*100;
    }

    // 財報後2日漲幅
    let move2d = null;
    if (earnDate && candle && candle.s === "ok" && Array.isArray(candle.t) && Array.isArray(candle.c)) {
      const ed = Math.floor(new Date(earnDate + "T16:00:00Z").getTime() / 1000);
      const idx = candle.t.findIndex(t => t >= ed);
      if (idx > 0 && idx + 2 < candle.c.length && candle.c[idx - 1] > 0) {
        move2d = (candle.c[idx + 2] - candle.c[idx - 1]) / candle.c[idx - 1] * 100;
      }
    }

    const rev = revSur == null ? 50 : clamp(50 + revSur * 4, 0, 100);
    const eps = epsSur == null ? 50 : clamp(50 + epsSur * 2.5, 0, 100);
    const unp = move2d == null ? 50 : clamp(80 - Math.abs(move2d) * 6, 0, 100);
    const tec = rsi == null ? 50 : (rsi < 30 ? 90 : rsi > 70 ? 25 : clamp(50 + (50 - rsi) * 0.9, 0, 100));
    const total = rev * 0.3 + eps * 0.3 + unp * 0.2 + tec * 0.2;

    // 分析原因（不納入選股邏輯，僅顯示）
    let analysis = "";
    if (rsi != null) {
      if (rsi < 30) analysis += `RSI ${r1(rsi)} 超賣反彈; `;
      else if (rsi > 70) analysis += `RSI ${r1(rsi)} 過熱拉回; `;
      else analysis += `RSI ${r1(rsi)} 中性; `;
    }
    if (epsSur != null) analysis += `EPS超預期 ${r1(epsSur)}%; `;
    if (revSur != null) analysis += `營收年增 ${r1(revSur)}%; `;
    if (move2d != null) analysis += `財報後2日 ${r1(move2d)}% 未充分反映; `;
    if (!analysis) analysis = "數據收集中，技術面觀察";

    return res.status(200).json({
      symbol: sym,
      price: price == null ? null : r2(price),
      changePercent: changePercent == null ? null : r1(changePercent),
      prevClose: prevClose == null ? null : r2(prevClose),
      total: r1(total),
      scores: { rev: r1(rev), eps: r1(eps), unp: r1(unp), tec: r1(tec) },
      detail: {
        earnDate: earnDate,
        revSurprise: revSur == null ? null : r1(revSur),
        epsSurprise: epsSur == null ? null : r1(epsSur),
        rsi: rsi == null ? null : r1(rsi),
        move2d: move2d == null ? null : r1(move2d)
      },
      analysis: analysis.trim()
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
