import { useEffect, useState } from "react";

declare global {
  interface Window {
    stockDoneUpdates?: {
      version: () => Promise<string>;
      check: () => Promise<{ ok: boolean; version?: string | null; error?: string }>;
      install: () => Promise<{ ok: boolean }>;
      onAvailable: (callback: () => void) => void;
      onProgress: (callback: (percent: number) => void) => void;
      onReady: (callback: () => void) => void;
    };
  }
}

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = window.stockDoneUpdates;
    if (!u) return;
    u.version().then(v => setVersion(v)).catch(() => {});
    u.onAvailable(() => setAvailable(true));
    u.onProgress(p => { setProgress(Math.max(0, Math.min(100, Number(p) || 0))); setAvailable(true); });
    u.onReady(() => { setReady(true); setAvailable(true); setProgress(100); });
    u.check().then(r => { if (r.ok && r.version) { setVersion(r.version); setAvailable(true); } }).catch(() => {});
  }, []);

  if (!available) return null;

  const install = async () => {
    if (!window.stockDoneUpdates || busy) return;
    setBusy(true);
    try { await window.stockDoneUpdates.install(); } catch { setBusy(false); }
  };

  return (
    <div style={{position:"fixed",right:20,bottom:20,zIndex:9999,maxWidth:380,padding:"14px 16px",borderRadius:12,background:"#fff",boxShadow:"0 8px 30px rgba(0,0,0,.18)",border:"1px solid #dbe5f0"}}>
      <strong>{ready ? "StockDone update ready" : "StockDone update downloading"}</strong>
      <div style={{fontSize:13,marginTop:5,color:"#5b6775"}}>
        {ready ? `Version ${version || "new"} is ready. Restart once to apply it.` : `New version ${version || "available"} is downloading automatically.`}
      </div>
      {!ready && <div style={{marginTop:10,height:6,background:"#e9eef5",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${progress}%`,background:"#1976d2",transition:"width .2s"}} /></div>}
      {ready && <button className="primary" disabled={busy} onClick={install} style={{marginTop:10}}>{busy ? "Restarting..." : "Restart & Update"}</button>}
    </div>
  );
}
