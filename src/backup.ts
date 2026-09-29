const KEYS=["stockdone.products","stockdone.sales","stockdone.movements","stockdone.suppliers","stockdone.purchases","stockdone.customers","stockdone.customer.transactions","stockdone.returns","stockdone.invoice.settings"];
export function createBackup(){const data:Record<string,string|null>={};for(const k of KEYS)data[k]=localStorage.getItem(k);return JSON.stringify({app:"StockDone",version:1,createdAt:new Date().toISOString(),data},null,2)}
export function downloadBackup(){const blob=new Blob([createBackup()],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="stockdone-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();URL.revokeObjectURL(url)}
export function restoreBackup(raw:string){
  let b:unknown;
  try{b=JSON.parse(raw)}catch{throw new Error("Invalid StockDone backup JSON.")}
  if(!b||typeof b!=="object"||Array.isArray(b))throw new Error("Invalid StockDone backup.");
  const backup=b as {app?:unknown;version?:unknown;data?:unknown};
  if(backup.app!=="StockDone"||backup.version!==1||!backup.data||typeof backup.data!=="object"||Array.isArray(backup.data))throw new Error("Invalid StockDone backup.");
  const data=backup.data as Record<string,unknown>;
  for(const k of KEYS){
    const value=data[k];
    if(value!==null&&typeof value!=="string")throw new Error("Invalid backup data for "+k+".");
  }
  const previous=Object.fromEntries(KEYS.map(k=>[k,localStorage.getItem(k)])) as Record<string,string|null>;
  try{
    for(const k of KEYS){
      const value=data[k];
      if(value===null)localStorage.removeItem(k);
      else localStorage.setItem(k,value as string);
    }
  }catch(error){
    for(const k of KEYS){
      try{
        const value=previous[k];
        if(value===null)localStorage.removeItem(k);
        else localStorage.setItem(k,value);
      }catch{}
    }
    throw new Error(error instanceof Error?"Backup restore failed: "+error.message:"Backup restore failed.");
  }
  location.reload();
}
