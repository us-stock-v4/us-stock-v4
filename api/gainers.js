// GET /api/gainers -> { top10: [{ symbol, price, changePct }] }
// Finnhub 免費版沒有「漲幅榜」端點，這裡用觀察名單逐檔取 quote 後排序。
// Vercel Serverless Function. 需要環境變數 FINNHUB_API_KEY
const KEY = process.env.FINNHUB_API_KEY;
const WATCH = ["NVDA","TSLA","AAPL","AMD","META","MSFT","AMZN","GOOGL","AVGO","NFLX","PLTR","COIN","MSTR","SMCI","ARM","MU","QCOM","SHOP","SQ","ROKU","DKNG","SOFI","HOOD","RIVN","LCID","NIO","SNAP","UBER","ABNB","CRWD"];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=120");
  if (!KEY) return res.status(500).json({ error: "FINNHUB_API_KEY not set" });
  try {
    const rows = await Promise.all(WATCH.map(async (sym) => {
      try {
        const r = await fetch("https://finnhub.io/api/v1/quote?symbol=" + sym + "&token=" + KEY);
        const q = await r.json();
        if (q && q.c && q.dp != null) return { symbol: sym, price: q.c, changePct: q.dp };
      } catch (e) {}
      return null;
    }));
    const top10 = rows.filter(Boolean).sort((a, b) => b.changePct - a.changePct).slice(0, 10);
    return res.status(200).json({ top10 });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
