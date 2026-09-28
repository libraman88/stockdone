export type SyncStatus = "pending" | "synced" | "failed";
export type SyncOperation = {
  id:string; entity:string; entityId:string;
  operation:"create"|"update"|"delete";
  payload:unknown; createdAt:string; status:SyncStatus; attempts:number;
  lastError?:string;
};

const KEY="stockdone.sync.queue";

function read():SyncOperation[]{try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch{return []}}
function write(q:SyncOperation[]){localStorage.setItem(KEY,JSON.stringify(q))}

export const syncQueue={
  get:():SyncOperation[]=>read(),
  enqueue:(item:Omit<SyncOperation,"id"|"createdAt"|"status"|"attempts">)=>{
    const q=read();
    const entry={...item,id:crypto.randomUUID(),createdAt:new Date().toISOString(),status:"pending" as const,attempts:0};
    q.push(entry); write(q); return entry;
  },
  pending:()=>read().filter(x=>x.status==="pending"),
  mark:(id:string,status:SyncStatus,error?:string)=>{
    const q=read().map(x=>x.id===id?{...x,status,lastError:error,attempts:x.attempts+(status==="failed"?1:0)}:x);
    write(q);
  },
  clearSynced:()=>write(read().filter(x=>x.status!=="synced"))
};

export function isOnline(){
  return typeof navigator!=="undefined" && navigator.onLine;
}

export function startConnectivitySync(onChange:(online:boolean)=>void){
  if(typeof window==="undefined") return ()=>{};
  const online=()=>onChange(true);
  const offline=()=>onChange(false);
  window.addEventListener("online",online);
  window.addEventListener("offline",offline);
  return ()=>{window.removeEventListener("online",online);window.removeEventListener("offline",offline)};
}
