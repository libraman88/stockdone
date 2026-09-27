export type OfflineState={online:boolean;lastSync:string|null};
const KEY="stockdone.offline.state";
export const offlineState={
 get:():OfflineState=>{try{return JSON.parse(localStorage.getItem(KEY)||'{"online":true,"lastSync":null}')}catch{return {online:true,lastSync:null}}},
 markSynced:()=>localStorage.setItem(KEY,JSON.stringify({online:navigator.onLine,lastSync:new Date().toISOString()}))
};
export function watchConnectivity(onChange:(online:boolean)=>void){const online=()=>onChange(true),offline=()=>onChange(false);window.addEventListener("online",online);window.addEventListener("offline",offline);return()=>{window.removeEventListener("online",online);window.removeEventListener("offline",offline)}}
