import { apiRequest, ApiError } from "./api";
import { authStorage } from "./auth";
import { isOnline } from "./sync";

type OfflineBridge = { status:()=>Promise<{available:boolean}>; exec:(sql:string,params?:unknown[])=>Promise<unknown>; query:<T=Record<string,unknown>>(sql:string,params?:unknown[])=>Promise<T[]> };
declare global { interface Window { stockDoneOffline?: OfflineBridge; } }

export const offlineDb = {
  available: async()=>Boolean(window.stockDoneOffline && (await window.stockDoneOffline.status()).available),
  exec:(sql:string,params:unknown[]=[])=>{if(!window.stockDoneOffline)throw new Error("Offline database bridge unavailable.");return window.stockDoneOffline.exec(sql,params)},
  query:<T=Record<string,unknown>>(sql:string,params:unknown[]=[])=>{if(!window.stockDoneOffline)throw new Error("Offline database bridge unavailable.");return window.stockDoneOffline.query<T>(sql,params)}
};

export async function resetOfflineTransactionalData(){if(!(await offlineDb.available()))return;await offlineDb.exec("BEGIN");try{for(const t of ["sale_items","sales","purchase_items","purchases","supplier_transactions","stock_movements","sync_queue","sync_conflicts"]){await offlineDb.exec(`DELETE FROM ${t}`)}await offlineDb.exec("UPDATE products SET qty=0,updated_at=?",[new Date().toISOString()]);await offlineDb.exec("COMMIT")}catch(e){await offlineDb.exec("ROLLBACK");throw e}}

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

export async function queueOfflineSale(sale:{id:string;invoiceNo:string;total:number;paymentMethod:string;discount:number;customerId?:string|null;received?:number;change?:number;businessId?:string;branchId?:string;items:{id:string;productId:string;qty:number;price:number;unitCost:number}[]}) {
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  const now=new Date().toISOString();
  const session=authStorage.getSession();
  const scopedSale={...sale,businessId:sale.businessId||session?.businessId,branchId:sale.branchId||session?.branchId};
  if(!scopedSale.businessId||!scopedSale.branchId)throw new Error("Offline sale cannot be queued without branch context.");
  await offlineDb.exec("BEGIN");
  try {
    for(const item of sale.items){const rows=await offlineDb.query<{qty:number}>("SELECT qty FROM products WHERE id=?",[item.productId]);if(!rows[0]||Number(rows[0].qty)<item.qty)throw new Error("Insufficient offline stock.");}
    await offlineDb.exec("INSERT INTO sales(id,invoice_no,client_reference,total,payment_method,discount,customer_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",[sale.id,sale.invoiceNo,sale.id,sale.total,sale.paymentMethod,sale.discount,sale.customerId??null,"completed",now]);
    for(const item of sale.items){
      await offlineDb.exec("INSERT INTO sale_items(id,sale_id,product_id,qty,price,unit_cost) VALUES(?,?,?,?,?,?)",[item.id,sale.id,item.productId,item.qty,item.price,item.unitCost]);
      await offlineDb.exec("UPDATE products SET qty=qty-?,updated_at=? WHERE id=?",[item.qty,now,item.productId]);
      await offlineDb.exec("INSERT INTO stock_movements(id,product_id,type,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),item.productId,"sale",-item.qty,"offline_sale",sale.id,now]);
    }
    await offlineDb.exec("INSERT INTO sync_queue(id,entity,entity_id,operation,payload,created_at,status) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),"sale",sale.id,"create",JSON.stringify(scopedSale),now,"pending"]);
    await offlineDb.exec("COMMIT");
  } catch(e){await offlineDb.exec("ROLLBACK");throw e;}
}

export async function queueOfflinePurchase(purchase:{id:string;invoiceNo:string;total:number;paymentMethod:string;paidAmount:number;supplierId:string;items:{id:string;productId:string;qty:number;price:number;unitCost:number}[]}) {
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  const session=authStorage.getSession();
  if(!session?.businessId||!session?.branchId)throw new Error("Offline purchase cannot be queued without branch context.");
  if(purchase.paymentMethod==="credit"&&purchase.paidAmount>0)throw new Error("Invalid credit payment.");
  if(purchase.paidAmount>purchase.total)throw new Error("Payment exceeds purchase.");
  const now=new Date().toISOString();
  await offlineDb.exec("BEGIN");
  try{
    const duplicate=await offlineDb.query<{id:string}>("SELECT id FROM purchases WHERE invoice_no=?",[purchase.invoiceNo]);
    if(duplicate[0])throw new Error("Duplicate purchase invoice.");
    await offlineDb.exec("INSERT INTO purchases(id,invoice_no,supplier_id,total,payment_method,paid_amount,created_at) VALUES(?,?,?,?,?,?,?)",[purchase.id,purchase.invoiceNo,purchase.supplierId,purchase.total,purchase.paymentMethod,purchase.paidAmount,now]);
    for(const item of purchase.items){
      const stock=await offlineDb.query<{qty:number}>("SELECT qty FROM products WHERE id=?",[item.productId]);
      if(!stock[0])throw new Error("Product is not available in offline stock cache.");
      await offlineDb.exec("INSERT INTO purchase_items(id,purchase_id,product_id,qty,cost) VALUES(?,?,?,?,?)",[item.id,purchase.id,item.productId,item.qty,item.unitCost]);
      await offlineDb.exec("UPDATE products SET qty=qty+?,updated_at=? WHERE id=?",[item.qty,now,item.productId]);
      await offlineDb.exec("INSERT INTO stock_movements(id,product_id,type,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),item.productId,"purchase",item.qty,"offline_purchase",purchase.id,now]);
    }
    const payable=purchase.total-purchase.paidAmount;
    if(payable>0)await offlineDb.exec("INSERT INTO supplier_transactions(id,supplier_id,type,amount,reference_id,note,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),purchase.supplierId,"purchase",payable,purchase.id,"Offline purchase payable",now]);
    if(purchase.paidAmount>0)await offlineDb.exec("INSERT INTO supplier_transactions(id,supplier_id,type,amount,reference_id,note,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),purchase.supplierId,"payment",purchase.paidAmount,purchase.id,"Paid with offline purchase",now]);
    await offlineDb.exec("INSERT INTO sync_queue(id,entity,entity_id,operation,payload,created_at,status) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),"purchase",purchase.id,"create",JSON.stringify({...purchase,businessId:session.businessId,branchId:session.branchId}),now,"pending"]);
    await offlineDb.exec("COMMIT");
  }catch(e){await offlineDb.exec("ROLLBACK");throw e;}
}
export async function queueOfflineExchange(x:{id:string;saleId:string;returned:{id:string;productId:string;qty:number}[];replacement:{id:string;productId:string;qty:number;price:number;unitCost:number}[];difference:number;customerId?:string|null}) {
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  const s=authStorage.getSession(); if(!s?.businessId||!s?.branchId)throw new Error("Offline exchange cannot be queued without branch context.");
  const now=new Date().toISOString(); await offlineDb.exec("BEGIN");
  try{
    for(const i of x.returned){const r=await offlineDb.query<{qty:number}>("SELECT qty FROM products WHERE id=?",[i.productId]);if(!r[0])throw new Error("Returned product is not available offline.");await offlineDb.exec("UPDATE products SET qty=qty+?,updated_at=? WHERE id=?",[i.qty,now,i.productId]);await offlineDb.exec("INSERT INTO stock_movements(id,product_id,type,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),i.productId,"exchange_return",i.qty,"offline_exchange",x.id,now]);}
    for(const i of x.replacement){const r=await offlineDb.query<{qty:number}>("SELECT qty FROM products WHERE id=?",[i.productId]);if(!r[0]||Number(r[0].qty)<i.qty)throw new Error("Insufficient offline stock for exchange.");await offlineDb.exec("UPDATE products SET qty=qty-?,updated_at=? WHERE id=?",[i.qty,now,i.productId]);await offlineDb.exec("INSERT INTO stock_movements(id,product_id,type,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),i.productId,"exchange_sale",-i.qty,"offline_exchange",x.id,now]);}
    await offlineDb.exec("INSERT INTO sync_queue(id,entity,entity_id,operation,payload,created_at,status) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),"exchange",x.id,"create",JSON.stringify({...x,businessId:s.businessId,branchId:s.branchId}),now,"pending"]);
    await offlineDb.exec("COMMIT");
  }catch(e){await offlineDb.exec("ROLLBACK");throw e;}
}
export async function syncPendingExchanges() {
  if(!isOnline()||!(await offlineDb.available()))return{synced:0,failed:0};
  const rows=await offlineDb.query<{id:string;payload:string}>("SELECT id,payload FROM sync_queue WHERE entity='exchange' AND operation='create' AND status='pending' ORDER BY created_at");
  let synced=0,failed=0;
  for(const row of rows)try{
    const x=JSON.parse(row.payload),s=authStorage.getSession();
    if(!s?.businessId||!s?.branchId||x.businessId!==s.businessId||x.branchId!==s.branchId)continue;
    await apiRequest("/returns",{method:"POST",body:JSON.stringify({saleId:x.saleId,type:"exchange",clientReference:x.id,refundAmount:0,items:x.returned.map((i:any)=>({variantId:i.productId,quantity:i.qty,unitPrice:0})),exchangeItems:x.replacement.map((i:any)=>({variantId:i.productId,quantity:i.qty,unitPrice:i.price}))})});
    await offlineDb.exec("UPDATE sync_queue SET status='synced',synced_at=?,last_error=NULL WHERE id=?",[new Date().toISOString(),row.id]);synced++;
  }catch(e){
    const message=e instanceof Error?e.message:"Exchange sync failed",status=e instanceof ApiError?e.status:0;
    const permanent=status>=400&&status<500&&status!==401&&status!==408&&status!==429;
    await offlineDb.exec("UPDATE sync_queue SET status=?,attempts=attempts+1,last_error=? WHERE id=?",[permanent?"failed":"pending",message,row.id]);failed++;
  }
  return{synced,failed};
}
export async function queueOfflineReturn(ret:{id:string;saleId:string;items:{id:string;productId:string;qty:number;refund:number;unitCost:number}[];refund:number;customerId?:string|null}) {
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  const s=authStorage.getSession(); if(!s?.businessId||!s?.branchId)throw new Error("Offline return cannot be queued without branch context.");
  const now=new Date().toISOString(); await offlineDb.exec("BEGIN");
  try{
    for(const i of ret.items){
      const rows=await offlineDb.query<{qty:number}>("SELECT qty FROM products WHERE id=?",[i.productId]);
      if(!rows[0])throw new Error("Product is not available offline.");
      await offlineDb.exec("UPDATE products SET qty=qty+?,updated_at=? WHERE id=?",[i.qty,now,i.productId]);
      await offlineDb.exec("INSERT INTO stock_movements(id,product_id,type,quantity,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),i.productId,"return",i.qty,"offline_return",ret.id,now]);
    }
    await offlineDb.exec("INSERT INTO sync_queue(id,entity,entity_id,operation,payload,created_at,status) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),"return",ret.id,"create",JSON.stringify({...ret,businessId:s.businessId,branchId:s.branchId}),now,"pending"]);
    await offlineDb.exec("COMMIT");
  }catch(e){await offlineDb.exec("ROLLBACK");throw e;}
}
export async function syncPendingReturns() {
  if(!isOnline()||!(await offlineDb.available()))return{synced:0,failed:0};
  const rows=await offlineDb.query<{id:string;payload:string}>("SELECT id,payload FROM sync_queue WHERE entity='return' AND operation='create' AND status='pending' ORDER BY created_at");
  let synced=0,failed=0;
  for(const row of rows)try{
    const r=JSON.parse(row.payload),s=authStorage.getSession();
    if(!s?.businessId||!s?.branchId||r.businessId!==s.businessId||r.branchId!==s.branchId)continue;
    await apiRequest("/returns",{method:"POST",body:JSON.stringify({saleId:r.saleId,type:"return",clientReference:r.id,refundAmount:r.refund,items:r.items.map((i:any)=>({variantId:i.productId,quantity:i.qty,unitPrice:i.refund/i.qty})),exchangeItems:[]})});
    await offlineDb.exec("UPDATE sync_queue SET status='synced',synced_at=?,last_error=NULL WHERE id=?",[new Date().toISOString(),row.id]);synced++;
  }catch(e){
    const message=e instanceof Error?e.message:"Return sync failed",status=e instanceof ApiError?e.status:0;
    const permanent=status>=400&&status<500&&status!==401&&status!==408&&status!==429;
    await offlineDb.exec("UPDATE sync_queue SET status=?,attempts=attempts+1,last_error=? WHERE id=?",[permanent?"failed":"pending",message,row.id]);failed++;
  }
  return{synced,failed};
}
export async function cacheOfflineCustomer(customer:{id:string;name:string;phone?:string|null;balance?:number}) {
  if(!(await offlineDb.available()))return;
  await offlineDb.exec("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,balance REAL NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)");
  await offlineDb.exec("INSERT INTO customers(id,name,phone,balance,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,balance=excluded.balance,updated_at=excluded.updated_at",[customer.id,customer.name,customer.phone??null,customer.balance??0,new Date().toISOString()]);
}
export async function queueOfflineCustomerPayment(payment:{id:string;customerId:string;amount:number;note?:string}) {
  if(!(await offlineDb.available()))throw new Error("Offline database is unavailable.");
  const session=authStorage.getSession(); if(!session?.businessId||!session?.branchId)throw new Error("Offline payment cannot be queued without branch context.");
  if(payment.amount<=0)throw new Error("Payment amount must be positive.");
  const now=new Date().toISOString(); await offlineDb.exec("BEGIN");
  try {
    const rows=await offlineDb.query<{balance:number}>("SELECT balance FROM customers WHERE id=?",[payment.customerId]);
    if(!rows[0])throw new Error("Customer is not available offline.");
    if(payment.amount>Number(rows[0].balance))throw new Error("Payment exceeds customer balance.");
    await offlineDb.exec("UPDATE customers SET balance=balance-?,updated_at=? WHERE id=?",[payment.amount,now,payment.customerId]);
    await offlineDb.exec("INSERT INTO sync_queue(id,entity,entity_id,operation,payload,created_at,status) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),"customer_payment",payment.id,"create",JSON.stringify({...payment,businessId:session.businessId,branchId:session.branchId}),now,"pending"]);
    await offlineDb.exec("COMMIT");
  } catch(e){await offlineDb.exec("ROLLBACK");throw e;}
}
export async function syncPendingCustomerPayments() {
  if(!isOnline()||!(await offlineDb.available()))return{synced:0,failed:0};
  const rows=await offlineDb.query<{id:string;payload:string}>("SELECT id,payload FROM sync_queue WHERE entity='customer_payment' AND operation='create' AND status='pending' ORDER BY created_at");
  let synced=0,failed=0;
  for(const row of rows)try{
    const p=JSON.parse(row.payload),s=authStorage.getSession();
    if(!s?.businessId||!s?.branchId||p.businessId!==s.businessId||p.branchId!==s.branchId)continue;
    await apiRequest(`/customers/${p.customerId}/payment`,{method:"POST",body:JSON.stringify({amount:p.amount,note:p.note||"Offline customer payment"})});
    await offlineDb.exec("UPDATE sync_queue SET status='synced',synced_at=?,last_error=NULL WHERE id=?",[new Date().toISOString(),row.id]);synced++;
  }catch(e){
    const message=e instanceof Error?e.message:"Customer payment sync failed",status=e instanceof ApiError?e.status:0;
    const permanent=status>=400&&status<500&&status!==401&&status!==408&&status!==429;
    await offlineDb.exec("UPDATE sync_queue SET status=?,attempts=attempts+1,last_error=? WHERE id=?",[permanent?"failed":"pending",message,row.id]);failed++;
  }
  return{synced,failed};
}
export async function syncPendingPurchases() {
  if(!isOnline()||!(await offlineDb.available()))return{synced:0,failed:0};
  const rows=await offlineDb.query<{id:string;entity_id:string;payload:string}>("SELECT id,entity_id,payload FROM sync_queue WHERE entity='purchase' AND operation='create' AND status='pending' ORDER BY created_at");
  let synced=0,failed=0;
  for(const row of rows){
    try{
      const purchase=JSON.parse(row.payload); const session=authStorage.getSession();
      if(!session?.businessId||!session?.branchId||purchase.businessId!==session.businessId||purchase.branchId!==session.branchId)continue;
      await apiRequest("/purchases",{method:"POST",body:JSON.stringify({invoiceNo:purchase.invoiceNo,supplierId:purchase.supplierId,items:purchase.items.map((i:any)=>({variantId:i.productId,quantity:i.qty,cost:i.unitCost})),paymentMethod:purchase.paymentMethod,paidAmount:purchase.paidAmount})});
      await offlineDb.exec("UPDATE sync_queue SET status='synced',synced_at=?,last_error=NULL WHERE id=?",[new Date().toISOString(),row.id]);synced++;
    }catch(e){
      const message=e instanceof Error?e.message:"Purchase sync failed"; const status=e instanceof ApiError?e.status:0;
      const permanent=status>=400&&status<500&&status!==401&&status!==408&&status!==429;
      await offlineDb.exec("UPDATE sync_queue SET status=?,attempts=attempts+1,last_error=? WHERE id=?",[permanent?"failed":"pending",message,row.id]);
      failed++;
    }
  }
  return{synced,failed};
}

export async function syncPendingSales() {
  if(!isOnline()||!(await offlineDb.available()))return{synced:0,failed:0};
  const rows=await offlineDb.query<{id:string;entity_id:string;payload:string}>("SELECT id,entity_id,payload FROM sync_queue WHERE entity='sale' AND operation='create' AND status='pending' ORDER BY created_at");
  let synced=0,failed=0;
  for(const row of rows){
    try{
      const sale=JSON.parse(row.payload);
      const session=authStorage.getSession();
      if(!session?.businessId||!session?.branchId||sale.businessId!==session.businessId||sale.branchId!==session.branchId)continue;
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
    void Promise.all([syncPendingSales(),syncPendingPurchases(),syncPendingCustomerPayments(),syncPendingReturns(),syncPendingExchanges()])
      .then(results=>{const synced=results.reduce((total,result)=>total+result.synced,0);if(synced>0)onSynced?.(synced)})
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
  const result=await syncPendingSales(); await syncPendingPurchases(); await syncPendingCustomerPayments();
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
