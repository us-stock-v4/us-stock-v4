// GET /api/score?symbol=IOT -> { symbol, total, scores:{rev,eps,unp,tec}, detail:{earnDate,revSurprise,epsSurprise,rsi} }
// 權重：營收 30% + EPS 30% + 未反映 20% + 技術 20%
// Vercel Serverless Function. 需要環境變數 FINNHUB_API_KEY
const KEY = process.env.FINNHUB_API_KEY;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;

async function j(url) {
  const r = await fetch(url);
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
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=300");
  const sym = String(req.query.symbol || "").trim().toUpperCase();
  if (!sym) return res.status(400).json({ error: "missing symbol" });
  if (!KEY) return res.status(500).json({ error: "FINNHUB_API_KEY not set" });
  try {
    const now = Math.floor(Date.now() / 1000);
    const enc = encodeURIComponent(sym);

    const [earn, candle] = await Promise.all([
      j("https://finnhub.io/api/v1/stock/earnings?symbol=" + enc + "&token=" + KEY),
      j("https://finnhub.io/api/v1/stock/candle?symbol=" + enc +
        "&resolution=D&from=" + (now - 150 * 86400) + "&to=" + now + "&token=" + KEY)
    ]);

    // EPS 超預期（最新一季 actual vs estimate）
    let epsSur = null, earnDate = null;
    if (Array.isArray(earn) && earn.length) {
      const e = earn[0];
      earnDate = e.period || null;
      if (e.actual != null && e.estimate) epsSur = (e.actual - e.estimate) / Math.abs(e.estimate) * 100;
    }

    // 營收：用季度營收年增率當代理指標
    let revSur = null;
    try {
      const m = await j("https://finnhub.io/api/v1/stock/metric?symbol=" + enc + "&metric=all&token=" + KEY);
      if (m && m.metric && m.metric.revenueGrowthQuarterlyYoy != null) {
        revSur = m.metric.revenueGrowthQuarterlyYoy * 100;
      }
    } catch (e) {}

    // RSI(14)
    let rsi = null;
    if (candle && candle.s === "ok" && Array.isArray(candle.c)) rsi = rsi14(candle.c);

    // 財報後 2 日漲幅（未反映程度）：財報日往後第 2 根日K vs 財報日前一根日K
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
    const unp = move2d == null ? 50 : clamp(80 - Math.abs(move2d) * 6, 0, 100); // 漲幅越小越「未反映」，分數越高
    const tec = rsi == null ? 50 : (rsi < 30 ? 90 : rsi > 70 ? 25 : clamp(50 + (50 - rsi) * 0.9, 0, 100));
    const total = rev * 0.3 + eps * 0.3 + unp * 0.2 + tec * 0.2;

    return res.status(200).json({
      symbol: sym,
      total: r1(total),
      scores: { rev: r1(rev), eps: r1(eps), unp: r1(unp), tec: r1(tec) },
      detail: {
        earnDate: earnDate,
        revSurprise: revSur == null ? null : r1(revSur),
        epsSurprise: epsSur == null ? null : r1(epsSur),
        rsi: rsi == null ? null : r1(rsi)
      }
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
