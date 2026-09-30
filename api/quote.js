// GET /api/quote?symbol=IOT,M,UAL -> { prices: { IOT: 37.5, ... } }
// Vercel Serverless Function. 需要環境變數 FINNHUB_API_KEY
const KEY = process.env.FINNHUB_API_KEY;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
  const symbols = String(req.query.symbol || "")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (!symbols.length) return res.status(400).json({ error: "missing symbol" });
  if (!KEY) return res.status(500).json({ error: "FINNHUB_API_KEY not set" });
  try {
    const prices = {};
    await Promise.all(symbols.map(async (sym) => {
      const r = await fetch("https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(sym) + "&token=" + KEY);
      const q = await r.json();
      if (q && q.c) prices[sym] = q.c;
    }));
    return res.status(200).json({ prices });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
