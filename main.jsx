import React, { useState, useMemo, useCallback } from "react";
import { TrendingUp, TrendingDown, Search, Star, X, AlertTriangle, Loader2, ChevronRight, ArrowLeft, Building2 } from "lucide-react";

/* ============================== 設計代幣 ============================== */
const FONT_STACK = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',-apple-system,sans-serif";
const MONO_STACK = "'JetBrains Mono','Roboto Mono',ui-monospace,monospace";

const C = {
  base: "#0a1420", panel: "#101f2f", alt: "#16293b", border: "#1e3a4c",
  teal: "#2dd4bf", tealDim: "#14b8a6", text1: "#e2e8f0", text2: "#8fa3b0",
  green: "#4ade80", red: "#f87171", amber: "#fbbf24",
};

/* ============================== 個股 → 產業對照表 ==============================
   台股公開 API 沒有乾淨的產業分類欄位,這裡用手動整理的常見權值股對照表
   涵蓋 13 個主要產業,作為產業強度計算與選股的基礎池
================================================================================= */
const STOCK_INDUSTRY_MAP = {
  "2330": { name: "台積電", industry: "半導體" },
  "2454": { name: "聯發科", industry: "半導體" },
  "2303": { name: "聯電", industry: "半導體" },
  "3711": { name: "日月光投控", industry: "半導體" },
  "2317": { name: "鴻海", industry: "電子零組件" },
  "2382": { name: "廣達", industry: "電子零組件" },
  "2308": { name: "台達電", industry: "電子零組件" },
  "2357": { name: "華碩", industry: "電子零組件" },
  "2412": { name: "中華電", industry: "電信" },
  "3045": { name: "台灣大", industry: "電信" },
  "4904": { name: "遠傳", industry: "電信" },
  "2881": { name: "富邦金", industry: "金融" },
  "2882": { name: "國泰金", industry: "金融" },
  "2891": { name: "中信金", industry: "金融" },
  "2886": { name: "兆豐金", industry: "金融" },
  "2603": { name: "長榮", industry: "航運" },
  "2609": { name: "陽明", industry: "航運" },
  "2615": { name: "萬海", industry: "航運" },
  "2002": { name: "中鋼", industry: "鋼鐵" },
  "2014": { name: "中鴻", industry: "鋼鐵" },
  "1301": { name: "台塑", industry: "塑膠" },
  "1303": { name: "南亞", industry: "塑膠" },
  "1326": { name: "台化", industry: "塑膠" },
  "1216": { name: "統一", industry: "食品" },
  "1101": { name: "台泥", industry: "水泥" },
  "2207": { name: "和泰車", industry: "汽車" },
  "2201": { name: "裕隆", industry: "汽車" },
  "6505": { name: "台塑化", industry: "石化" },
  "3008": { name: "大立光", industry: "光電" },
  "2409": { name: "友達", industry: "光電" },
  "1476": { name: "儒鴻", industry: "紡織" },
  "9910": { name: "豐泰", industry: "紡織" },
  "1789": { name: "神隆", industry: "生技醫療" },
  "6446": { name: "藥華藥", industry: "生技醫療" },
};
const INDUSTRIES = [...new Set(Object.values(STOCK_INDUSTRY_MAP).map((s) => s.industry))];

/* ============================== 範例資料產生器(API 無法使用時的備援) ============================== */
function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function generateDemoStockPool() {
  const rand = seededRandom(2026);
  return Object.entries(STOCK_INDUSTRY_MAP).map(([code, info]) => {
    const close = +(20 + rand() * 550).toFixed(1);
    const changePct = +((rand() - 0.48) * 5).toFixed(2);
    const revenueYoy = +((rand() - 0.35) * 40).toFixed(1);
    const netBuyStreak = Math.round((rand() - 0.5) * 12); // 正=連續買超天數,負=連續賣超天數
    return {
      code, name: info.name, industry: info.industry, close, changePct,
      per: +(8 + rand() * 28).toFixed(1),
      pbr: +(0.8 + rand() * 4.5).toFixed(2),
      yield: +(rand() * 7.5).toFixed(2),
      revenueYoy, netBuyStreak,
    };
  });
}

function computeIndustryScores(stocks) {
  const marketAvgChange = stocks.reduce((a, s) => a + s.changePct, 0) / stocks.length;
  const byIndustry = {};
  stocks.forEach((s) => {
    if (!byIndustry[s.industry]) byIndustry[s.industry] = [];
    byIndustry[s.industry].push(s);
  });
  return Object.entries(byIndustry).map(([industry, list]) => {
    const avgChange = list.reduce((a, s) => a + s.changePct, 0) / list.length;
    const rs = avgChange - marketAvgChange; // 相對強弱:產業平均漲幅 - 大盤平均漲幅
    const avgRevYoy = list.reduce((a, s) => a + s.revenueYoy, 0) / list.length;
    const avgNetBuy = list.reduce((a, s) => a + s.netBuyStreak, 0) / list.length;
    // 三合一分數:相對強弱 + 營收年增 + 法人買超天數,各自標準化後加總
    const score = rs * 3 + avgRevYoy * 0.8 + avgNetBuy * 2;
    return { industry, stockCount: list.length, rs, avgRevYoy, avgNetBuy, score, stocks: list };
  }).sort((a, b) => b.score - a.score);
}

function scoreLabel(score) {
  if (score > 15) return { text: "強勢", color: C.green };
  if (score > 0) return { text: "轉強中", color: C.tealDim };
  if (score > -15) return { text: "持平", color: C.amber };
  return { text: "轉弱", color: C.red };
}

/* ============================== 台股資料 API 串接 ============================== */
// 透過自建 Cloudflare Worker proxy 轉發請求,繞過瀏覽器 CORS 限制
const PROXY_BASE = "https://twse-proxy.archie940606.workers.dev/";
function proxied(targetUrl) {
  return `${PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
}

// 三大法人買賣超(依個股): 用於計算資金流向。這支走舊版 www.twse.com.tw 端點,
// 需帶日期參數,且假日無資料,所以由今天往前回溯最多 6 天直到抓到資料
async function fetchInstitutionalNetBuy() {
  for (let daysBack = 0; daysBack < 6; daysBack++) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const res = await fetch(proxied(`https://www.twse.com.tw/fund/T86?response=json&date=${dateStr}&selectType=ALL`));
    if (!res.ok) continue;
    const json = await res.json();
    if (json.stat !== "OK" || !json.data || json.data.length === 0) continue;
    const fields = json.fields;
    const codeIdx = fields.indexOf("證券代號");
    const netIdx = fields.indexOf("三大法人買賣超股數");
    if (codeIdx === -1 || netIdx === -1) continue;
    const map = {};
    json.data.forEach((row) => {
      const code = row[codeIdx];
      const netShares = parseFloat(String(row[netIdx] || "0").replace(/,/g, ""));
      if (code) map[code] = netShares;
    });
    return map;
  }
  throw new Error("三大法人買賣超近期皆無資料");
}

// 全市場當日行情
async function fetchDailyQuotesAll() {
  const res = await fetch(proxied("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"));
  if (!res.ok) throw new Error("當日行情 API 回應錯誤");
  return res.json();
}

// 本益比 / 股價淨值比 / 殖利率
async function fetchValuationAll() {
  const res = await fetch(proxied("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"));
  if (!res.ok) throw new Error("估值指標 API 回應錯誤");
  return res.json();
}

// 上市公司月營收(年增率)
async function fetchMonthlyRevenue() {
  const res = await fetch(proxied("https://openapi.twse.com.tw/v1/opendata/t187ap05_L"));
  if (!res.ok) throw new Error("月營收 API 回應錯誤");
  const json = await res.json();
  const map = {};
  json.forEach((row) => {
    const code = row["公司代號"];
    const yoy = parseFloat(row["營業收入-去年同月增減(%)"] ?? "");
    if (code && !Number.isNaN(yoy)) map[code] = yoy;
  });
  return map;
}

async function fetchRealStockPool() {
  const [quotes, valuation, institutional, revenue] = await Promise.all([
    fetchDailyQuotesAll(), fetchValuationAll(), fetchInstitutionalNetBuy(), fetchMonthlyRevenue(),
  ]);
  const valMap = {}; valuation.forEach((r) => { valMap[r.Code] = r; });
  const quoteMap = {}; quotes.forEach((r) => { quoteMap[r.Code] = r; });

  const pool = Object.entries(STOCK_INDUSTRY_MAP).map(([code, info]) => {
    const q = quoteMap[code]; const v = valMap[code] || {};
    if (!q) return null;
    const close = parseFloat(q.ClosingPrice) || 0;
    const change = parseFloat(q.Change) || 0;
    const changePct = close ? +((change / (close - change)) * 100).toFixed(2) : 0;
    const netBuy = institutional[code] || 0;
    return {
      code, name: info.name, industry: info.industry, close, changePct,
      per: parseFloat(v.PEratio) || null,
      pbr: parseFloat(v.PBratio) || null,
      yield: parseFloat(v.DividendYield) || null,
      revenueYoy: revenue[code] ?? 0,
      netBuyStreak: netBuy > 0 ? Math.round(netBuy / 1e6) : -Math.round(Math.abs(netBuy) / 1e6),
    };
  }).filter(Boolean);

  if (pool.length < 5) throw new Error("可比對資料過少");
  return pool;
}

/* ============================== 共用 UI 元件 ============================== */
function Panel({ children, style, ...rest }) {
  return <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, ...style }} {...rest}>{children}</div>;
}

function Btn({ children, onClick, variant = "primary", disabled, style, icon: Icon }) {
  const base = { display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", border: "1px solid transparent", opacity: disabled ? 0.5 : 1, fontFamily: FONT_STACK };
  const variants = {
    primary: { background: C.teal, color: "#062421" },
    ghost: { background: "transparent", color: C.teal, border: `1px solid ${C.tealDim}` },
    danger: { background: "transparent", color: C.red, border: `1px solid ${C.red}55` },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], ...style }}>{Icon && <Icon size={15} />}{children}</button>;
}

function Input({ label, ...props }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: C.text2 }}>
      {label}
      <input {...props} style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", color: C.text1, fontSize: 14, fontFamily: MONO_STACK, outline: "none", ...props.style }} />
    </label>
  );
}

function Badge({ text, color }) {
  return <span style={{ background: `${color}22`, color, border: `1px solid ${color}55`, borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>{text}</span>;
}

/* ============================== 白話重點產生器 ============================== */
function buildInsights(s) {
  const notes = [];
  if (s.per != null) notes.push(s.per < 15 ? `本益比 ${s.per} 倍,偏低` : s.per > 30 ? `本益比 ${s.per} 倍,偏高` : `本益比 ${s.per} 倍,尚可`);
  if (s.yield != null) notes.push(s.yield >= 4 ? `殖利率 ${s.yield}%,配息不錯` : `殖利率 ${s.yield}%,偏低`);
  notes.push(s.revenueYoy >= 10 ? `營收年增 ${s.revenueYoy.toFixed(1)}%,成長明顯` : s.revenueYoy < 0 ? `營收年減 ${Math.abs(s.revenueYoy).toFixed(1)}%,轉弱` : `營收年增 ${s.revenueYoy.toFixed(1)}%,持平`);
  notes.push(s.netBuyStreak > 0 ? `法人buying中,近期買超力道 ${s.netBuyStreak}` : s.netBuyStreak < 0 ? `法人賣超中,力道 ${Math.abs(s.netBuyStreak)}` : "法人動向不明顯");
  return notes;
}

/* ============================== 頂部 Ticker ============================== */
const TICKER_ITEMS = ["半導體 相對強弱↑", "航運 法人買超↑", "金融 營收持平", "生技醫療 轉強中", "鋼鐵 轉弱", "電信 穩定"];
function TickerStrip() {
  return (
    <div style={{ overflow: "hidden", borderBottom: `1px solid ${C.border}`, background: C.base, whiteSpace: "nowrap" }}>
      <style>{`@keyframes ticker-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}} @media (prefers-reduced-motion: reduce){.ticker-track{animation:none!important}}`}</style>
      <div className="ticker-track" style={{ display: "inline-block", animation: "ticker-scroll 30s linear infinite", padding: "8px 0" }}>
        {[...TICKER_ITEMS, ...TICKER_ITEMS].map((t, i) => (
          <span key={i} style={{ fontFamily: MONO_STACK, fontSize: 12.5, color: t.includes("↑") ? C.green : t.includes("轉弱") ? C.red : C.text2, marginRight: 32 }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id: "industry", label: "產業強度排行" },
  { id: "screener", label: "簡易選股" },
  { id: "watchlist", label: "觀察清單" },
];

/* ============================== 產業強度排行 Tab ============================== */
function IndustryRadar({ pool, setPool, loading, setLoading, usedDemo, setUsedDemo, error, setError, watchlist, setWatchlist }) {
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchRealStockPool();
      setPool(data); setUsedDemo(false);
    } catch (e) {
      setPool(generateDemoStockPool()); setUsedDemo(true);
      setError("無法完整取得證交所/公開資訊觀測站資料(API 欄位或 CORS 限制),已切換為範例資料展示產業分析功能。");
    }
    setLoading(false);
  }, []);

  const scores = useMemo(() => (pool ? computeIndustryScores(pool) : []), [pool]);
  const industryData = selected ? scores.find((s) => s.industry === selected) : null;
  const inWatchlist = (code) => watchlist.some((w) => w.code === code);
  const toggleWatch = (row) => setWatchlist(inWatchlist(row.code) ? watchlist.filter((w) => w.code !== row.code) : [...watchlist, row]);

  if (!pool) {
    return (
      <Panel style={{ textAlign: "center", padding: 40 }}>
        <Building2 size={32} color={C.tealDim} style={{ marginBottom: 12 }} />
        <p style={{ color: C.text2, marginBottom: 16 }}>掃描各產業的相對強弱、法人買賣超、月營收年增率,找出目前最值得留意的產業</p>
        <Btn icon={loading ? Loader2 : Search} onClick={load} disabled={loading}>{loading ? "分析中…" : "開始分析產業"}</Btn>
      </Panel>
    );
  }

  if (industryData) {
    return (
      <div style={{ display: "grid", gap: 20 }}>
        <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", color: C.teal, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <ArrowLeft size={16} /> 返回產業排行
        </button>
        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <h3 style={{ margin: 0, color: C.text1 }}>{industryData.industry}</h3>
            <Badge {...scoreLabel(industryData.score)} />
          </div>
          <p style={{ color: C.text2, fontSize: 13 }}>共 {industryData.stockCount} 檔追蹤個股 · 相對強弱 {industryData.rs >= 0 ? "+" : ""}{industryData.rs.toFixed(2)}% · 平均營收年增 {industryData.avgRevYoy.toFixed(1)}%</p>
        </Panel>
        <div style={{ display: "grid", gap: 12 }}>
          {industryData.stocks.map((s) => (
            <Panel key={s.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ fontFamily: MONO_STACK, color: C.teal, fontWeight: 700 }}>{s.code}</span>
                  <span style={{ color: C.text1, fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: C.text1, fontFamily: MONO_STACK }}>{s.close}</span>
                  <span style={{ color: s.changePct >= 0 ? C.green : C.red, fontFamily: MONO_STACK, fontSize: 13 }}>{s.changePct >= 0 ? "+" : ""}{s.changePct}%</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: C.text2, fontSize: 13, lineHeight: 1.8 }}>
                  {buildInsights(s).map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
              <button onClick={() => toggleWatch(s)} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
                <Star size={18} fill={inWatchlist(s.code) ? C.amber : "none"} color={inWatchlist(s.code) ? C.amber : C.text2} />
              </button>
            </Panel>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Panel style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, color: C.text2, fontSize: 13 }}>依「相對強弱 + 法人買賣超 + 營收年增率」綜合評分排序{usedDemo && <span style={{ color: C.amber }}>(範例資料)</span>}</p>
        <Btn variant="ghost" icon={loading ? Loader2 : Search} onClick={load} disabled={loading}>{loading ? "更新中…" : "重新整理"}</Btn>
      </Panel>
      {error && <p style={{ color: C.amber, fontSize: 13 }}><AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> {error}</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {scores.map((s, i) => {
          const label = scoreLabel(s.score);
          return (
            <Panel key={s.industry} onClick={() => setSelected(s.industry)}
              style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ color: C.text2, fontFamily: MONO_STACK, fontSize: 13, width: 24 }}>{i + 1}</span>
                <div>
                  <div style={{ color: C.text1, fontWeight: 700, fontSize: 15 }}>{s.industry}</div>
                  <div style={{ color: C.text2, fontSize: 12 }}>{s.stockCount} 檔 · 相對強弱 {s.rs >= 0 ? "+" : ""}{s.rs.toFixed(1)}% · 營收年增 {s.avgRevYoy.toFixed(1)}%</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Badge text={label.text} color={label.color} />
                <ChevronRight size={18} color={C.text2} />
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== 簡易選股 Tab ============================== */
function SimpleScreener({ pool, watchlist, setWatchlist }) {
  const [filters, setFilters] = useState({ perMax: 30, yieldMin: 0, revenueYoyMin: 0, onlyNetBuy: false });
  const setF = (k, v) => setFilters({ ...filters, [k]: v });

  const filtered = useMemo(() => {
    if (!pool) return [];
    return pool.filter((s) =>
      (filters.perMax === 0 || s.per == null || s.per <= filters.perMax) &&
      (s.yield == null || s.yield >= filters.yieldMin) &&
      s.revenueYoy >= filters.revenueYoyMin &&
      (!filters.onlyNetBuy || s.netBuyStreak > 0)
    ).sort((a, b) => b.revenueYoy - a.revenueYoy);
  }, [pool, filters]);

  const inWatchlist = (code) => watchlist.some((w) => w.code === code);
  const toggleWatch = (row) => setWatchlist(inWatchlist(row.code) ? watchlist.filter((w) => w.code !== row.code) : [...watchlist, row]);

  if (!pool) {
    return <Panel style={{ textAlign: "center", padding: 40 }}><p style={{ color: C.text2 }}>請先到「產業強度排行」載入資料</p></Panel>;
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Panel>
        <h3 style={{ marginTop: 0, color: C.text1 }}>用白話條件篩選</h3>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Input label="本益比上限" type="number" value={filters.perMax} onChange={(e) => setF("perMax", +e.target.value)} style={{ width: 90 }} />
          <Input label="殖利率下限%" type="number" value={filters.yieldMin} onChange={(e) => setF("yieldMin", +e.target.value)} style={{ width: 90 }} />
          <Input label="營收年增下限%" type="number" value={filters.revenueYoyMin} onChange={(e) => setF("revenueYoyMin", +e.target.value)} style={{ width: 110 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: C.text2, fontSize: 13.5, marginBottom: 4 }}>
            <input type="checkbox" checked={filters.onlyNetBuy} onChange={(e) => setF("onlyNetBuy", e.target.checked)} />
            只看法人買超中
          </label>
        </div>
      </Panel>
      <Panel>
        <h3 style={{ marginTop: 0, color: C.text1 }}>篩選結果 ({filtered.length}/{pool.length})</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((s) => (
            <div key={s.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.alt, padding: 14, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: MONO_STACK, color: C.teal, fontWeight: 700 }}>{s.code}</span>
                  <span style={{ color: C.text1, fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: C.text2, fontSize: 12 }}>{s.industry}</span>
                </div>
                <div style={{ color: C.text2, fontSize: 12.5, marginTop: 4 }}>{buildInsights(s).join(" · ")}</div>
              </div>
              <button onClick={() => toggleWatch(s)} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
                <Star size={17} fill={inWatchlist(s.code) ? C.amber : "none"} color={inWatchlist(s.code) ? C.amber : C.text2} />
              </button>
            </div>
          ))}
          {filtered.length === 0 && <p style={{ color: C.text2, textAlign: "center", padding: 16 }}>無符合條件的股票,試試放寬篩選條件</p>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================== 觀察清單 Tab ============================== */
function Watchlist({ watchlist, setWatchlist }) {
  return (
    <Panel>
      <h3 style={{ marginTop: 0, color: C.text1 }}>觀察清單 ({watchlist.length})</h3>
      {watchlist.length === 0 && <p style={{ color: C.text2 }}>從「產業強度排行」或「簡易選股」點擊星號加入</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {watchlist.map((w) => (
          <div key={w.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.alt, padding: 14, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: MONO_STACK, color: C.teal, fontWeight: 700 }}>{w.code}</span>
              <span style={{ color: C.text1 }}>{w.name}</span>
              <span style={{ color: C.text2, fontSize: 12 }}>{w.industry}</span>
              <span style={{ color: w.changePct >= 0 ? C.green : C.red, fontFamily: MONO_STACK, fontSize: 13, display: "flex", alignItems: "center", gap: 3 }}>
                {w.changePct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{w.changePct}%
              </span>
            </div>
            <button onClick={() => setWatchlist(watchlist.filter((x) => x.code !== w.code))} style={{ background: "transparent", border: "none", color: C.red, cursor: "pointer" }}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ============================== App 主體 ============================== */
export default function App() {
  const [tab, setTab] = useState("industry");
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(false);
  const [usedDemo, setUsedDemo] = useState(false);
  const [error, setError] = useState(null);
  const [watchlist, setWatchlist] = useState([]);

  return (
    <div style={{ minHeight: "100vh", background: C.base, fontFamily: FONT_STACK }}>
      <TickerStrip />
      <header style={{ padding: "24px 28px 0", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ margin: 0, color: C.text1, fontSize: 24 }}>台股產業雷達</h1>
          <span style={{ color: C.tealDim, fontSize: 13, fontFamily: MONO_STACK }}>Industry Radar</span>
        </div>
        <p style={{ color: C.text2, fontSize: 13, marginTop: 6 }}>找出資金正在流入、營收正在轉強的產業 — 不需要技術分析知識</p>
        <nav style={{ display: "flex", gap: 8, marginTop: 20, borderBottom: `1px solid ${C.border}` }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "10px 4px", marginRight: 20, fontSize: 14.5, color: tab === t.id ? C.teal : C.text2, borderBottom: tab === t.id ? `2px solid ${C.teal}` : "2px solid transparent", fontWeight: tab === t.id ? 700 : 500, display: "flex", alignItems: "center", gap: 4 }}>
              {t.label}{t.id === "watchlist" && watchlist.length > 0 && <span style={{ background: C.teal, color: "#062421", borderRadius: 10, fontSize: 10.5, padding: "1px 6px", fontWeight: 700 }}>{watchlist.length}</span>}
            </button>
          ))}
        </nav>
      </header>
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 28px 60px" }}>
        {tab === "industry" && (
          <IndustryRadar pool={pool} setPool={setPool} loading={loading} setLoading={setLoading}
            usedDemo={usedDemo} setUsedDemo={setUsedDemo} error={error} setError={setError}
            watchlist={watchlist} setWatchlist={setWatchlist} />
        )}
        {tab === "screener" && <SimpleScreener pool={pool} watchlist={watchlist} setWatchlist={setWatchlist} />}
        {tab === "watchlist" && <Watchlist watchlist={watchlist} setWatchlist={setWatchlist} />}
        <p style={{ color: C.text2, fontSize: 11.5, marginTop: 40, textAlign: "center", lineHeight: 1.7 }}>
          本平台僅供產業與個股研究參考,不構成投資建議,請自行判斷風險。<br />
          產業分類為手動整理之常見權值股對照表,涵蓋範圍有限;若證交所/公開資訊觀測站 API 無法直接存取,將自動切換為範例資料。
        </p>
      </main>
    </div>
  );
}
