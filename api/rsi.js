// GET /api/rsi?symbol=IOT -> { symbol, rsi }
// 用 Finnhub 日K計算 RSI(14)。Vercel Serverless Function. 需要環境變數 FINNHUB_API_KEY
const KEY = process.env.FINNHUB_API_KEY;

function rsi14(closes) {
  if (!closes || closes.length < 15) return null;
  let g = 0, l = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  const rs = g / l;
  return 100 - 100 / (1 + rs);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=300");
  const sym = String(req.query.symbol || "").trim().toUpperCase();
  if (!sym) return res.status(400).json({ error: "missing symbol" });
  if (!KEY) return res.status(500).json({ error: "FINNHUB_API_KEY not set" });
  try {
    const now = Math.floor(Date.now() / 1000);
    const r = await fetch("https://finnhub.io/api/v1/stock/candle?symbol=" + encodeURIComponent(sym) +
      "&resolution=D&from=" + (now - 120 * 86400) + "&to=" + now + "&token=" + KEY);
    const c = await r.json();
    const rsi = (c && c.s === "ok") ? rsi14(c.c) : null;
    return res.status(200).json({ symbol: sym, rsi: rsi == null ? null : Math.round(rsi * 10) / 10 });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
