import { apiRequest, ApiError } from "./api";
import { isOnline } from "./sync";

type OfflineBridge = { status:()=>Promise<{available:boolean}>; exec:(sql:string,params?:unknown[])=>Promise<unknown>; query:<T=Record<string,unknown>>(sql:string,params?:unknown[])=>Promise<T[]> };
declare global { interface Window { stockDoneOffline?: OfflineBridge; } }

export const offlineDb = {
  available: async()=>Boolean(window.stockDoneOffline && (await window.stockDoneOffline.status()).available),
  exec:(sql:string,params:unknown[]=[])=>{if(!window.stockDoneOffline)throw new Error("Offline database bridge unavailable.");return window.stockDoneOffline.exec(sql,params)},
  query:<T=Record<string,unknown>>(sql:string,params:unknown[]=[])=>{if(!window.stockDoneOffline)throw new Error("Offline database bridge unavailable.");return window.stockDoneOffline.query<T>(sql,params)}
};

export async function cacheProduct(product:{id:string;name:string;sku:string;category?:string|null;size?:string|null;color?:string|null;barcode?:string|null;cost:number;price:number;qty:number;reorderLevel:number}) {
  if(!(await offlineDb.available()))return;
  const now=new Date().toISOString();
  await offlineDb.exec(`INSERT INTO products(id,name,sku,category,size,color,barcode,cost,price,qty,reorder_level,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sku=excluded.sku,category=excluded.category,size=excluded.size,color=excluded.color,barcode=excluded.barcode,cost=excluded.cost,price=excluded.price,qty=excluded.qty,reorder_level=excluded.reorder_level,updated_at=excluded.updated_at`,[product.id,product.name,product.sku,product.category??null,product.size??null,product.color??null,product.barcode??null,product.cost,product.price,product.qty,product.reorderLevel,now]);
}
export async function cacheProducts(products:Parameters<typeof cacheProduct>[0][]) { for(const p of products)await cacheProduct(p); }

export async function getCachedProducts() {
  if(!(await offlineDb.available())) return [];
  return offlineDb.query<{
    id:string;name:string;sku:string;category:string|null;size:string|null;color:string|null;
    barcode:string|null;cost:number;price:number;qty:number;reorder_level:number
  }>("SELECT id,name,sku,category,size,color,barcode,cost,price,qty,reorder_level FROM products ORDER BY name");
}

export async function queueOfflineSale(sale:{id:string;invoiceNo:string;total:number;paymentMethod:string;discount:number;customerId?:string|null;received?:number;change?:number;items:{id:string;productId:string;qty:number;price:number;unitCost:number}[]}) {
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  const now=new Date().toISOString();
  await offlineDb.exec("BEGIN");
  try {
    for(const item of sale.items){const rows=await offlineDb.query<{qty:number}>("SELECT qty FROM products WHERE id=?",[item.productId]);if(!rows[0]||Number(rows[0].qty)<item.qty)throw new Error("Insufficient offline stock.");}
    await offlineDb.exec("INSERT INTO sales(id,invoice_no,client_reference,total,payment_method,discount,customer_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",[sale.id,sale.invoiceNo,sale.id,sale.total,sale.paymentMethod,sale.discount,sale.customerId??null,"completed",now]);
    for(const item of sale.items){
      await offlineDb.exec("INSERT INTO sale_items(id,sale_id,product_id,qty,price,unit_cost) VALUES(?,?,?,?,?,?)",[item.id,sale.id,item.productId,item.qty,item.price,item.unitCost]);
      await offlineDb.exec("UPDATE products SET qty=qty-?,updated_at=? WHERE id=?",[item.qty,now,item.productId]);
      await offlineDb.exec("INSERT INTO stock_movements(id,product_id,type,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),item.productId,"sale",-item.qty,"offline_sale",sale.id,now]);
    }
    await offlineDb.exec("INSERT INTO sync_queue(id,entity,entity_id,operation,payload,created_at,status) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),"sale",sale.id,"create",JSON.stringify(sale),now,"pending"]);
    await offlineDb.exec("COMMIT");
  } catch(e){await offlineDb.exec("ROLLBACK");throw e;}
}

export async function syncPendingSales() {
  if(!isOnline()||!(await offlineDb.available()))return{synced:0,failed:0};
  const rows=await offlineDb.query<{id:string;entity_id:string;payload:string}>("SELECT id,entity_id,payload FROM sync_queue WHERE entity='sale' AND operation='create' AND status='pending' ORDER BY created_at");
  let synced=0,failed=0;
  for(const row of rows){
    try{
      const sale=JSON.parse(row.payload);
      await apiRequest("/sales",{method:"POST",body:JSON.stringify({invoiceNo:sale.invoiceNo,clientReference:sale.id,paymentMethod:sale.paymentMethod,discount:sale.discount,customerId:sale.customerId||undefined,received:sale.received,change:sale.change,items:sale.items.map((i:any)=>({variantId:i.productId,qty:i.qty,price:i.price}))})});
      await offlineDb.exec("UPDATE sync_queue SET status='synced',synced_at=?,last_error=NULL WHERE id=?",[new Date().toISOString(),row.id]);synced++;
    }catch(e){
      const message=e instanceof Error?e.message:"Sync failed";
      const status=e instanceof ApiError?e.status:0;
      const permanent=status>=400&&status<500&&status!==401&&status!==408&&status!==429;
      if(permanent){
        await offlineDb.exec("UPDATE sync_queue SET status='failed',attempts=attempts+1,last_error=? WHERE id=?",[message,row.id]);
        await offlineDb.exec("INSERT INTO sync_conflicts(id,entity,entity_id,local_payload,server_payload,detected_at,resolution) SELECT ?,?,?,?,?,?,'pending' WHERE NOT EXISTS (SELECT 1 FROM sync_conflicts WHERE entity='sale' AND entity_id=? AND resolution='pending')",[crypto.randomUUID(),"sale",row.entity_id,row.payload,JSON.stringify({error:message,status}),new Date().toISOString(),row.entity_id]);
      } else {
        await offlineDb.exec("UPDATE sync_queue SET attempts=attempts+1,last_error=? WHERE id=?",[message,row.id]);
      }
      failed++;
    }
  }
  return{synced,failed};
}

export function startOfflineSync(onSynced?: (count:number)=>void) {
  if(typeof window==="undefined")return()=>{};
  let running=false;
  const run=()=>{
    if(running)return;
    running=true;
    void syncPendingSales()
      .then(r=>{if(r.synced>0)onSynced?.(r.synced)})
      .finally(()=>{running=false});
  };
  window.addEventListener("online",run);
  run();
  const timer=window.setInterval(run,30000);
  return()=>{window.removeEventListener("online",run);window.clearInterval(timer)};
}

export async function getOfflineSyncConflicts(){
  if(!(await offlineDb.available()))return [];
  return offlineDb.query<{id:string;entity:string;entity_id:string;local_payload:string;server_payload:string;detected_at:string;resolution:string}>("SELECT * FROM sync_conflicts WHERE resolution='pending' ORDER BY detected_at DESC");
}
export async function retryOfflineSyncConflict(conflictId:string){
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  await offlineDb.exec("UPDATE sync_queue SET status='pending',last_error=NULL WHERE entity_id=(SELECT entity_id FROM sync_conflicts WHERE id=?) AND entity='sale'",[conflictId]);
  await offlineDb.exec("UPDATE sync_conflicts SET resolution='retrying' WHERE id=?",[conflictId]);
  const result=await syncPendingSales();
  const rows=await offlineDb.query<{status:string}>("SELECT status FROM sync_queue WHERE entity='sale' AND entity_id=(SELECT entity_id FROM sync_conflicts WHERE id=?) ORDER BY created_at DESC LIMIT 1",[conflictId]);
  if(rows[0]?.status==="synced") await offlineDb.exec("UPDATE sync_conflicts SET resolution='resolved' WHERE id=?",[conflictId]);
  else await offlineDb.exec("UPDATE sync_conflicts SET resolution='pending' WHERE id=?",[conflictId]);
  return result;
}
export async function resolveOfflineSyncConflict(conflictId:string){
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  await offlineDb.exec("UPDATE sync_conflicts SET resolution='resolved' WHERE id=?",[conflictId]);
  await offlineDb.exec("UPDATE sync_queue SET status='failed' WHERE entity_id=(SELECT entity_id FROM sync_conflicts WHERE id=?) AND entity='sale'",[conflictId]);
}
