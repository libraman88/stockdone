export type SyncStatus="pending"|"synced"|"failed";
export type SyncOperation={id:string;entity:string;entityId:string;operation:"create"|"update"|"delete";payload:unknown;createdAt:string;status:SyncStatus;attempts:number};

const KEY="stockdone.sync.queue";
export const syncQueue={
 get:():SyncOperation[]=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch{return []}},
 enqueue:(item:Omit<SyncOperation,"id"|"createdAt"|"status"|"attempts">)=>{const q=syncQueue.get();q.push({...item,id:crypto.randomUUID(),createdAt:new Date().toISOString(),status:"pending",attempts:0});localStorage.setItem(KEY,JSON.stringify(q));return q[q.length-1]},
 pending:()=>syncQueue.get().filter(x=>x.status==="pending"),
 mark:(id:string,status:SyncStatus)=>{const q=syncQueue.get().map(x=>x.id===id?{...x,status,attempts:x.attempts+(status==="failed"?1:0)}:x);localStorage.setItem(KEY,JSON.stringify(q))}
};
export function isOnline(){return typeof navigator!=="undefined"&&navigator.onLine}
