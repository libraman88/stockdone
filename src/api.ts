import { authStorage } from "./auth";
import { queueOfflineProduct, queueOfflineMasterMutation, cacheOfflineMasterTypes, cacheOfflineMasterItems, getCachedMasterItems, queueOfflineStockTransfer, queueOfflineTransferReceive, queueOfflineBranch, getCachedStockTransfers, queueOfflineAdminMutation, queueOfflineRawMaterial, queueOfflineFabricLot, queueOfflineCmtJob, queueOfflineCmtJobUpdate, queueOfflineFinishedStock, queueOfflineSale, queueOfflinePurchase, queueOfflineCustomer, queueOfflineSupplier, queueOfflineCustomerPayment, queueOfflineSupplierPayment, queueOfflineInventoryAdjustment, queueOfflineReturn, queueOfflineExchange } from "./offlineDb";
import type { Product } from "./types";

const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
const runningInElectron = typeof window !== "undefined" && Boolean((window as Window & { stockDoneOffline?: unknown }).stockDoneOffline);
const browserApiUrl = typeof window !== "undefined" && window.location.hostname !== "localhost" ? "/api" : "http://localhost:4000/api";

// Keep local development/Electron on the existing localhost API, while deployed web
// builds use same-origin /api unless an explicit VITE_API_URL is configured.
// This prevents a hosted StockDone build from accidentally calling the user's PC.
const BASE_URL = configuredApiUrl || (runningInElectron ? "http://localhost:4000/api" : browserApiUrl);

let token = sessionStorage.getItem("stockdone.apiToken");

export function setApiToken(value: string | null) {
  token = value;
  if (value) sessionStorage.setItem("stockdone.apiToken", value);
  else sessionStorage.removeItem("stockdone.apiToken");
}

export class ApiError extends Error { constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; } }


function isNetworkFailure(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && /fetch|network|failed to fetch|load failed|connection/i.test(error.message));
}
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(BASE_URL + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof data?.error === "string" ? data.error : "API request failed", response.status);
  return data as T;
}

export function requestPasswordReset(username:string){return apiRequest<{ok:boolean;message:string}>("/auth/password-reset/request",{method:"POST",body:JSON.stringify({username})});}
export function confirmPasswordReset(token:string,password:string){return apiRequest<{ok:boolean}>("/auth/password-reset/confirm",{method:"POST",body:JSON.stringify({token,password})});}
export type AuthSession={id:string;created_at:string;expires_at:string;revoked_at:string|null};
export async function getAuthSessions(){try{return await apiRequest<AuthSession[]>("/auth/sessions");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const s=authStorage.getSession();if(!s)return [];const now=new Date();const expires=new Date(now.getTime()+30*24*60*60*1000);return [{id:"offline-session",created_at:now.toISOString(),expires_at:expires.toISOString(),revoked_at:null}];}}
export function logout(){return apiRequest<{ok:boolean}>("/auth/logout",{method:"POST"}).finally(()=>setApiToken(null));}
export function logoutAll(){return apiRequest<{ok:boolean}>("/auth/logout-all",{method:"POST"}).finally(()=>setApiToken(null));}

export function setupOwner(input:{businessName:string;branchName:string;branchCode:string;ownerName:string;username:string;password:string}) {
  return apiRequest<{token:string;user:{id:string;username:string;name:string;role:string}}>("/auth/setup",{method:"POST",body:JSON.stringify(input)});
}

export async function getAuthMe() {
  try{return await apiRequest<{user:{sub:string;id:string;username:string;role:string;businessId:string;branchId:string;session:string}}>("/auth/me");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const session=authStorage.getSession();
    if(!session?.id||!session.businessId||!session.branchId)throw error;
    return {user:{sub:session.id,id:session.id,username:session.username,role:session.role,businessId:session.businessId,branchId:session.branchId,session:"offline"}};
  }
}

export function login(username: string, password: string) {
  return apiRequest<{token:string;user:{id:string;username:string;name:string;role:string;businessId?:string;branchId?:string}}>("/auth/login", {
    method: "POST", body: JSON.stringify({username,password})
  });
}


const electronOffline = () => typeof window !== "undefined" && Boolean((window as Window & { stockDoneOffline?: unknown }).stockDoneOffline);
async function offlineQuery<T>(sql:string, params:unknown[]=[]):Promise<T[]> {
  if (!electronOffline()) throw new Error("Offline database unavailable.");
  const bridge = (window as Window & { stockDoneOffline?: { query:<R=Record<string,unknown>>(sql:string,params?:unknown[])=>Promise<R[]> } }).stockDoneOffline;
  if (!bridge) throw new Error("Offline database unavailable.");
  return bridge.query<T>(sql, params);
}
async function offlineExec(sql:string, params:unknown[]=[]):Promise<void> {
  if (!electronOffline()) throw new Error("Offline database unavailable.");
  const bridge = (window as Window & { stockDoneOffline?: { exec:(sql:string,params?:unknown[])=>Promise<unknown> } }).stockDoneOffline;
  if (!bridge) throw new Error("Offline database unavailable.");
  await bridge.exec(sql, params);
}

export async function getProducts() {
  try {
    const rows = await apiRequest<Product[]>("/products");
    return rows.map((p: any) => ({...p, variantId: p.variantId || p.variant_id, masterValues:p.masterValues||p.master_values||{}, reorderLevel: Number(p.reorderLevel ?? p.reorder_level ?? 5), qty: Number(p.qty ?? 0), cost: Number(p.cost ?? 0), price: Number(p.price ?? 0)}));
  } catch (error) {
    if (!electronOffline() || !isNetworkFailure(error)) throw error;
    const rows = await offlineQuery<any>("SELECT id,name,sku,category,brand,sub_category AS subCategory,floor,warehouse,size,color,barcode,cost,price,qty,master_values FROM products WHERE COALESCE(active,1)=1 ORDER BY name");
    return rows.map((p:any)=>({...p,variantId:p.id,reorderLevel:Number(p.reorderLevel ?? 5),qty:Number(p.qty ?? 0),cost:Number(p.cost ?? 0),price:Number(p.price ?? 0),masterValues:(()=>{try{return p.master_values?JSON.parse(p.master_values):{}}catch{return {}}})()})) as Product[];
  }
}

export async function updateProduct(id:string, product: Partial<Omit<Product,"id">>) { const body={...product,id}; try{return await apiRequest<{ok:boolean;id:string}>(`/products/${id}`,{method:"PUT",body:JSON.stringify({...body,categoryId:(product as any).categoryId||null,masterValues:(product as any).masterValues||{}})});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineProduct(body,"update");return {ok:true,id};} }
export async function deleteProduct(id:string){ try{return await apiRequest<{ok:boolean;id:string;archived:boolean}>(`/products/${id}`,{method:"DELETE"});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineProduct({id},"delete");return {ok:true,id,archived:true};} }

export async function createProduct(product: Omit<Product,"id">) { const localProduct={...product,id:crypto.randomUUID()};
  try{return await apiRequest<{id:string;variantId:string}>("/products", {
    method: "POST",
    body: JSON.stringify({
      name: product.name, sku: product.sku, categoryId: (product as any).categoryId || null,
      brand: product.brand || null, subCategory: product.subCategory || null, floor: product.floor || null, warehouse: product.warehouse || null,
      size: product.size || null, color: product.color || null,
      barcode: product.barcode || null, cost: product.cost,
      price: product.price, qty: product.qty, reorderLevel: product.reorderLevel, masterValues:(product as any).masterValues||{}
    })
  });}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineProduct(localProduct,"create");return {id:localProduct.id,variantId:localProduct.id};}}

export type ApiSaleItem = { variantId: string; qty: number; price: number };
export async function createSale(input: { invoiceNo: string; clientReference?: string; paymentMethod: "cash"|"card"|"bank"|"other"; discount: number; customerId?: string; received?: number; change?: number; items: ApiSaleItem[] }) {
  try {
    return await apiRequest<{id:string;invoiceNo:string;total:number}>("/sales", { method: "POST", body: JSON.stringify(input) });
  } catch (error) {
    if (!electronOffline() || !isNetworkFailure(error)) throw error;
    const id = input.clientReference || crypto.randomUUID();
    const placeholders = input.items.map(()=>"?").join(",");
    const products = await offlineQuery<any>("SELECT id,cost FROM products WHERE id IN (" + placeholders + ")", input.items.map(i=>i.variantId));
    const byId = new Map(products.map((p:any)=>[p.id,p]));
    const items = input.items.map((item)=>({id:crypto.randomUUID(),productId:item.variantId,qty:item.qty,price:item.price,unitCost:Number(byId.get(item.variantId)?.cost||0)}));
    const total = Math.max(0,input.items.reduce((sum,item)=>sum + Number(item.price)*Number(item.qty),0) - Number(input.discount||0));
    await queueOfflineSale({id,invoiceNo:input.invoiceNo,total,paymentMethod:input.paymentMethod,discount:Number(input.discount||0),customerId:input.customerId||null,received:input.received,change:input.change,items});
    return {id,invoiceNo:input.invoiceNo,total};
  }
}

export async function createPurchase(input: { invoiceNo: string; supplierId?: string; paymentMethod?: "cash"|"card"|"bank"|"credit"; paidAmount?: number; items: { variantId: string; quantity: number; cost: number }[] }) {
  try {
    return await apiRequest<{id:string;invoiceNo:string;total:number}>("/purchases", { method: "POST", body: JSON.stringify(input) });
  } catch (error) {
    if (!electronOffline() || !isNetworkFailure(error)) throw error;
    const id = crypto.randomUUID();
    if (!input.supplierId) throw new Error("Offline purchase requires a supplier.");
    const items = input.items.map((item)=>({id:crypto.randomUUID(),productId:item.variantId,qty:item.quantity,price:item.cost,unitCost:item.cost}));
    const total = items.reduce((sum,item)=>sum + Number(item.price)*Number(item.qty),0);
    await queueOfflinePurchase({id,invoiceNo:input.invoiceNo,total,paymentMethod:input.paymentMethod||"cash",paidAmount:Number(input.paidAmount||0),supplierId:input.supplierId,items});
    return {id,invoiceNo:input.invoiceNo,total};
  }
}

export type ApiCustomer = { id:string; name:string; phone?:string|null; address?:string|null; balance:number };
export async function getCustomers(){try{return await apiRequest<ApiCustomer[]>("/customers");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await offlineExec("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,address TEXT,balance REAL NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)");return offlineQuery<ApiCustomer>("SELECT id,name,phone,address,balance FROM customers ORDER BY name");}}
export async function createCustomer(input:{name:string;phone?:string;address?:string}){try{return await apiRequest<ApiCustomer>("/customers",{method:"POST",body:JSON.stringify(input)});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const id=crypto.randomUUID();await queueOfflineCustomer({id,...input});return {id,name:input.name,phone:input.phone||null,address:input.address||null,balance:0};}}
export async function recordCustomerPayment(id:string,amount:number,note?:string){
  try {
    return await apiRequest<{customerId:string;balance:number}>(`/customers/${id}/payment`,{method:"POST",body:JSON.stringify({amount,note})});
  } catch (error) {
    if (!electronOffline() || !isNetworkFailure(error)) throw error;
    const paymentId=crypto.randomUUID();
    await queueOfflineCustomerPayment({id:paymentId,customerId:id,amount,note});
    const rows=await offlineQuery<{balance:number}>("SELECT balance FROM customers WHERE id=?",[id]);
    return {customerId:id,balance:Number(rows[0]?.balance||0)};
  }
}

export type ApiReturnItem={variantId:string;quantity:number;unitPrice:number};
export async function createReturn(input:{saleId:string;type:"return"|"exchange";refundAmount:number;refundMethod?:"cash"|"card"|"bank"|"other";items:ApiReturnItem[];exchangeItems?:ApiReturnItem[]}){
  try {
    return await apiRequest<{id:string;type:string;refundAmount:number;priceDifference:number}>("/returns",{method:"POST",body:JSON.stringify(input)});
  } catch (error) {
    if (!electronOffline() || !isNetworkFailure(error)) throw error;
    const id=crypto.randomUUID();
    const allItems=[...input.items,...(input.exchangeItems||[])];
    const placeholders=allItems.map(()=>"?").join(",");
    const products=await offlineQuery<any>("SELECT id,cost FROM products WHERE id IN (" + placeholders + ")",allItems.map(i=>i.variantId));
    const costs=new Map(products.map((p:any)=>[p.id,Number(p.cost||0)]));
    if(input.type==="return"){
      await queueOfflineReturn({id,saleId:input.saleId,items:input.items.map(i=>({id:crypto.randomUUID(),productId:i.variantId,qty:i.quantity,refund:i.unitPrice*i.quantity,unitCost:costs.get(i.variantId)||0})),refund:Number(input.refundAmount||0)});
      return {id,type:"return",refundAmount:Number(input.refundAmount||0),priceDifference:0};
    }
    const returned=input.items.map(i=>({id:crypto.randomUUID(),productId:i.variantId,qty:i.quantity}));
    const replacement=(input.exchangeItems||[]).map(i=>({id:crypto.randomUUID(),productId:i.variantId,qty:i.quantity,price:i.unitPrice,unitCost:costs.get(i.variantId)||0}));
    const priceDifference=Math.max(0,replacement.reduce((s,i)=>s+i.price*i.qty,0)-input.items.reduce((s,i)=>s+i.unitPrice*i.quantity,0));
    await queueOfflineExchange({id,saleId:input.saleId,returned,replacement,difference:priceDifference});
    return {id,type:"exchange",refundAmount:Number(input.refundAmount||0),priceDifference};
  }
}
export async function getSales(){try{return await apiRequest<any[]>("/sales");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const rows=await offlineQuery<any>("SELECT id,invoice_no,client_reference,total,payment_method,discount,customer_id,status,created_at FROM sales ORDER BY created_at DESC");const items=await offlineQuery<any>("SELECT si.sale_id,si.product_id,si.qty,si.price,p.name,p.sku,p.size,p.color FROM sale_items si LEFT JOIN products p ON p.id=si.product_id ORDER BY si.id");return rows.map((s:any)=>({id:s.id,invoiceNo:s.invoice_no,total:Number(s.total),paymentMethod:s.payment_method,discount:Number(s.discount),customerId:s.customer_id,createdAt:s.created_at,status:s.status,items:items.filter((i:any)=>i.sale_id===s.id).map((i:any)=>({id:i.product_id,productId:i.product_id,variantId:i.product_id,qty:Number(i.qty),price:Number(i.price),name:i.name,sku:i.sku,size:i.size,color:i.color}))}));}}

export type ReportSummary={sales:{invoices:number;sales_total:number;discounts:number};profit:{gross_profit:number};inventory:{variants:number;units:number;cost_value:number;retail_value:number};lowStock:Array<{name:string;sku:string;size:string|null;color:string|null;quantity:number;reorder_level:number}>};
export async function getReportSummary(from:string,to:string){
  try{return await apiRequest<ReportSummary>(`/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const sales=await offlineQuery<any>(`SELECT COUNT(*) AS invoices,COALESCE(SUM(total),0) AS sales_total,COALESCE(SUM(discount),0) AS discounts FROM sales WHERE substr(created_at,1,10) BETWEEN ? AND ?`,[from,to]);
    const profit=await offlineQuery<any>(`SELECT COALESCE(SUM((si.price-si.unit_cost)*si.qty),0)-COALESCE((SELECT SUM(discount) FROM sales WHERE substr(created_at,1,10) BETWEEN ? AND ?),0) AS gross_profit FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE substr(s.created_at,1,10) BETWEEN ? AND ?`,[from,to,from,to]);
    const inventory=await offlineQuery<any>(`SELECT COUNT(*) AS variants,COALESCE(SUM(qty),0) AS units,COALESCE(SUM(qty*cost),0) AS cost_value,COALESCE(SUM(qty*price),0) AS retail_value FROM products`);
    const lowStock=await offlineQuery<any>(`SELECT name,sku,size,color,qty AS quantity,reorder_level FROM products WHERE qty<=reorder_level ORDER BY name`);
    return {sales:{invoices:Number(sales[0]?.invoices||0),sales_total:Number(sales[0]?.sales_total||0),discounts:Number(sales[0]?.discounts||0)},profit:{gross_profit:Number(profit[0]?.gross_profit||0)},inventory:{variants:Number(inventory[0]?.variants||0),units:Number(inventory[0]?.units||0),cost_value:Number(inventory[0]?.cost_value||0),retail_value:Number(inventory[0]?.retail_value||0)},lowStock} as ReportSummary;
  }
}
export type DashboardSummary=ReportSummary;
export function getDashboardSummary(from:string,to:string){return getReportSummary(from,to);}

export type DailySalesReport={date:string;invoices:number;total:number;discounts:number};
export type RecentSale={id:string;invoice_no:string;total:number;payment_method:string;created_at:string;customer:string};
export type TopProduct={name:string;sku:string;units:number;sales:number};
export async function getDashboardRecent(){
  try{return await apiRequest<RecentSale[]>("/dashboard/recent");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    return (await offlineQuery<any>(`SELECT s.id,s.invoice_no,s.total,s.payment_method,s.created_at,COALESCE(c.name,'Walk-in') AS customer FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.created_at DESC LIMIT 10`)).map((x:any)=>({...x,total:Number(x.total)})) as RecentSale[];
  }
}
export async function getDashboardTopProducts(){
  try{return await apiRequest<TopProduct[]>("/dashboard/top-products");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    return (await offlineQuery<any>(`SELECT p.name,p.sku,COALESCE(SUM(si.qty),0) AS units,COALESCE(SUM(si.qty*si.price),0) AS sales FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id WHERE substr(s.created_at,1,10)=? GROUP BY p.id,p.name,p.sku ORDER BY sales DESC LIMIT 10`,[new Date().toISOString().slice(0,10)])).map((x:any)=>({...x,units:Number(x.units),sales:Number(x.sales)})) as TopProduct[];
  }
}

export type PaymentReport={method:string;invoices:number;total:number};
export type ProductReport={name:string;sku:string;size:string|null;color:string|null;units:number;sales:number;cost:number;gross_profit:number};
export async function getSalesReport(from:string,to:string){
  try{return await apiRequest<{daily:DailySalesReport[];payments:PaymentReport[]}>(`/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const daily=await offlineQuery<any>("SELECT substr(created_at,1,10) AS date,COUNT(*) AS invoices,COALESCE(SUM(total),0) AS total,COALESCE(SUM(discount),0) AS discounts FROM sales WHERE substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? GROUP BY substr(created_at,1,10) ORDER BY date",[from,to]);
    const payments=await offlineQuery<any>("SELECT payment_method AS method,COUNT(*) AS invoices,COALESCE(SUM(total),0) AS total FROM sales WHERE substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? GROUP BY payment_method ORDER BY total DESC",[from,to]);
    return {daily:daily.map((x:any)=>({...x,invoices:Number(x.invoices),total:Number(x.total),discounts:Number(x.discounts)})),payments:payments.map((x:any)=>({...x,invoices:Number(x.invoices),total:Number(x.total)}))};
  }
}
export type PaymentTransactionReport={method:string;transactions:number;total:number};
export async function getPaymentReport(from:string,to:string){
  try{return await apiRequest<PaymentTransactionReport[]>(`/reports/payments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const rows=await offlineQuery<any>("SELECT payment_method AS method,COUNT(*) AS transactions,COALESCE(SUM(total),0) AS total FROM sales WHERE substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? GROUP BY payment_method ORDER BY total DESC",[from,to]);
    return rows.map((x:any)=>({...x,transactions:Number(x.transactions),total:Number(x.total)}));
  }
}
export type ReturnProfitImpact={returned_sales:number;returned_cost:number;exchange_sales:number;exchange_cost:number;transactions:number;net_sales_impact:number;gross_profit_impact:number};
export async function getReturnProfitImpact(from:string,to:string){
  try{return await apiRequest<ReturnProfitImpact>(`/reports/profit-returns?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    await offlineExec("CREATE TABLE IF NOT EXISTS returns (id TEXT PRIMARY KEY,type TEXT NOT NULL,sale_id TEXT NOT NULL,refund_amount REAL NOT NULL DEFAULT 0,price_difference REAL NOT NULL DEFAULT 0,business_id TEXT,branch_id TEXT,created_at TEXT NOT NULL)");
    await offlineExec("CREATE TABLE IF NOT EXISTS return_items (id TEXT PRIMARY KEY,return_id TEXT NOT NULL,variant_id TEXT NOT NULL,quantity INTEGER NOT NULL,direction TEXT NOT NULL,unit_price REAL NOT NULL DEFAULT 0,unit_cost REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL)");
    const rows=await offlineQuery<any>(`SELECT COALESCE(SUM(CASE WHEN ri.direction='in' THEN ri.quantity*ri.unit_price ELSE 0 END),0) AS returned_sales,
      COALESCE(SUM(CASE WHEN ri.direction='in' THEN ri.quantity*ri.unit_cost ELSE 0 END),0) AS returned_cost,
      COALESCE(SUM(CASE WHEN ri.direction='out' THEN ri.quantity*ri.unit_price ELSE 0 END),0) AS exchange_sales,
      COALESCE(SUM(CASE WHEN ri.direction='out' THEN ri.quantity*ri.unit_cost ELSE 0 END),0) AS exchange_cost,
      COUNT(DISTINCT r.id) AS transactions
      FROM returns r JOIN return_items ri ON ri.return_id=r.id
      WHERE substr(r.created_at,1,10)>=? AND substr(r.created_at,1,10)<=?`,[from,to]);
    const x=rows[0]||{};
    const returnedSales=Number(x.returned_sales||0),returnedCost=Number(x.returned_cost||0),exchangeSales=Number(x.exchange_sales||0),exchangeCost=Number(x.exchange_cost||0);
    return {returned_sales:returnedSales,returned_cost:returnedCost,exchange_sales:exchangeSales,exchange_cost:exchangeCost,transactions:Number(x.transactions||0),net_sales_impact:exchangeSales-returnedSales,gross_profit_impact:(returnedSales-returnedCost)-(exchangeSales-exchangeCost)};
  }
}
export type ProfitReport={summary:{invoices:number;gross_sales:number;discounts:number;net_sales:number;cogs:number;gross_profit:number;margin_percent:number};daily:Array<Record<string,unknown>>};
export async function getProfitReport(from:string,to:string){
  try{return await apiRequest<ProfitReport>(`/reports/profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const summaryRows=await offlineQuery<any>("SELECT COUNT(*) AS invoices,COALESCE(SUM(total+discount),0) AS gross_sales,COALESCE(SUM(discount),0) AS discounts,COALESCE(SUM(total),0) AS net_sales FROM sales WHERE substr(created_at,1,10)>=? AND substr(created_at,1,10)<=?",[from,to]);
    const costRows=await offlineQuery<any>("SELECT COALESCE(SUM(si.qty*si.unit_cost),0) AS cogs FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE substr(s.created_at,1,10)>=? AND substr(s.created_at,1,10)<=?",[from,to]);
    const daily=await offlineQuery<any>("SELECT substr(s.created_at,1,10) AS date,COUNT(DISTINCT s.id) AS invoices,COALESCE(SUM(s.total),0) AS net_sales,COALESCE(SUM(si.qty*si.unit_cost),0) AS cogs,COALESCE(SUM(si.qty*(si.price-si.unit_cost)),0) AS gross_profit FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id WHERE substr(s.created_at,1,10)>=? AND substr(s.created_at,1,10)<=? GROUP BY substr(s.created_at,1,10) ORDER BY date",[from,to]);
    const s=summaryRows[0]||{}; const grossSales=Number(s.gross_sales||0), discounts=Number(s.discounts||0), netSales=Number(s.net_sales||0), cogs=Number(costRows[0]?.cogs||0), grossProfit=netSales-cogs;
    return {summary:{invoices:Number(s.invoices||0),gross_sales:grossSales,discounts,net_sales:netSales,cogs,gross_profit:grossProfit,margin_percent:netSales?grossProfit/netSales*100:0},daily:daily.map((x:any)=>({...x,invoices:Number(x.invoices),net_sales:Number(x.net_sales),cogs:Number(x.cogs),gross_profit:Number(x.gross_profit)}))};
  }
}
export async function getProductReport(from:string,to:string){
  try{return await apiRequest<ProductReport[]>(`/reports/products?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const rows=await offlineQuery<any>("SELECT p.name,p.sku,p.size,p.color,COALESCE(SUM(si.qty),0) AS units,COALESCE(SUM(si.qty*si.price),0) AS sales,COALESCE(SUM(si.qty*si.unit_cost),0) AS cost,COALESCE(SUM(si.qty*(si.price-si.unit_cost)),0) AS gross_profit FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id WHERE substr(s.created_at,1,10)>=? AND substr(s.created_at,1,10)<=? GROUP BY p.id,p.name,p.sku,p.size,p.color ORDER BY sales DESC",[from,to]);
    return rows.map((x:any)=>({...x,units:Number(x.units),sales:Number(x.sales),cost:Number(x.cost),gross_profit:Number(x.gross_profit)}));
  }
}
export type CategoryReport={category:string;units:number;sales:number;cost:number;gross_profit:number};
export type CashierReport={cashier:string;invoices:number;sales:number;discounts:number};
export async function getCategoryReport(from:string,to:string){
  try{return await apiRequest<CategoryReport[]>(`/reports/categories?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const rows=await offlineQuery<any>("SELECT COALESCE(p.category,'Uncategorized') AS category,COALESCE(SUM(si.qty),0) AS units,COALESCE(SUM(si.qty*si.price),0) AS sales,COALESCE(SUM(si.qty*si.unit_cost),0) AS cost,COALESCE(SUM(si.qty*(si.price-si.unit_cost)),0) AS gross_profit FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id WHERE substr(s.created_at,1,10)>=? AND substr(s.created_at,1,10)<=? GROUP BY COALESCE(p.category,'Uncategorized') ORDER BY sales DESC",[from,to]);
    return rows.map((x:any)=>({...x,units:Number(x.units),sales:Number(x.sales),cost:Number(x.cost),gross_profit:Number(x.gross_profit)}));
  }
}
export async function getCashierReport(from:string,to:string){
  try{return await apiRequest<CashierReport[]>(`/reports/cashiers?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const rows=await offlineQuery<any>("SELECT 'Local' AS cashier,COUNT(*) AS invoices,COALESCE(SUM(total),0) AS sales,COALESCE(SUM(discount),0) AS discounts FROM sales WHERE substr(created_at,1,10)>=? AND substr(created_at,1,10)<=?",[from,to]);
    return rows.map((x:any)=>({...x,invoices:Number(x.invoices),sales:Number(x.sales),discounts:Number(x.discounts)}));
  }
}
export async function getPurchaseReport(from:string,to:string){
  try{return await apiRequest<any[]>(`/reports/purchases?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    return offlineQuery<any>("SELECT p.id,p.invoice_no,p.supplier_id,p.total,p.payment_method,p.paid_amount,p.created_at FROM purchases p WHERE substr(p.created_at,1,10)>=? AND substr(p.created_at,1,10)<=? ORDER BY p.created_at DESC",[from,to]);
  }
}
export async function getKhataReport(){
  try{return await apiRequest<any[]>("/reports/khata");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    await offlineExec("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,address TEXT,balance REAL NOT NULL DEFAULT 0)");
    const rows=await offlineQuery<any>("SELECT id,name,phone,address,balance FROM customers ORDER BY name");
    return rows.map((x:any)=>({...x,balance:Number(x.balance||0)}));
  }
}

export type AdminRole={id:string;name:string;permissions:string[]};
export type AdminPermission={code:string;description:string};
export async function getAdminRoles(){
  try{return await apiRequest<AdminRole[]>("/admin/roles");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const permissions=["admin","customers","inventory","products","purchases","reports","returns","sales","settings","users"];
    const custom=await offlineQuery<any>("SELECT id,name,permissions FROM admin_roles ORDER BY created_at");
    return [...custom.map(r=>({id:r.id,name:r.name,permissions:JSON.parse(r.permissions||"[]")})),
      {id:"offline-owner",name:"owner",permissions},
      {id:"offline-manager",name:"manager",permissions:["sales","products","inventory","purchases","customers","returns","reports"]},
      {id:"offline-cashier",name:"cashier",permissions:["sales","customers"]}
    ];
  }
}
export async function getAdminPermissions(){
  try{return await apiRequest<AdminPermission[]>("/admin/permissions");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    return [
      {code:"admin",description:"Administrative actions"},
      {code:"customers",description:"Manage customers and khata"},
      {code:"inventory",description:"Manage inventory"},
      {code:"products",description:"Manage products"},
      {code:"purchases",description:"Manage purchases"},
      {code:"reports",description:"View reports"},
      {code:"returns",description:"Process returns and exchanges"},
      {code:"sales",description:"Create and manage sales"},
      {code:"settings",description:"Manage system settings"},
      {code:"users",description:"Manage users and roles"},
      {code:"print",description:"Print receipts and documents"}
    ];
  }
}
export async function createAdminRole(input:{name:string;permissionCodes:string[]}){try{return await apiRequest<AdminRole>("/admin/roles",{method:"POST",body:JSON.stringify(input)});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const id=crypto.randomUUID();await queueOfflineAdminMutation({entity:"admin_role",operation:"create",id,payload:{id,...input}});return {id,name:input.name,permissions:input.permissionCodes};}}
export async function updateAdminRolePermissions(id:string,permissionCodes:string[]){try{return await apiRequest<{ok:boolean}>(`/admin/roles/${id}/permissions`,{method:"PUT",body:JSON.stringify({permissionCodes})});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineAdminMutation({entity:"admin_role",operation:"update",id,payload:{id,permissionCodes}});return {ok:true};}}
export type AuditLog={id:string;user_id:string|null;action:string;entity:string;entity_id:string|null;details:any;created_at:string};
export async function getAuditLogs(){
  try{return await apiRequest<AuditLog[]>("/audit-logs");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    await offlineExec("CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,details TEXT,created_at TEXT NOT NULL)");
    return offlineQuery<any>("SELECT id,user_id,action,entity,entity_id,details,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200").then(rows=>rows.map(r=>({...r,details:r.details?JSON.parse(r.details):null})));
  }
}
export type AdminUser={id:string;username:string;name:string;role:"owner"|"manager"|"cashier";active:boolean;created_at:string};
export async function getAdminUsers(){try{return await apiRequest<AdminUser[]>("/admin/users");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return authStorage.getUsers().map(u=>({id:u.id,username:u.username,name:u.name,role:u.role,active:u.active,created_at:new Date().toISOString()}));}}
export async function createAdminUser(input:{username:string;name:string;role:"manager"|"cashier";password:string}){try{return await apiRequest<AdminUser>("/admin/users",{method:"POST",body:JSON.stringify(input)});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const id=crypto.randomUUID();const now=new Date().toISOString();authStorage.saveUsers([...authStorage.getUsers(),{id,username:input.username,name:input.name,role:input.role,active:true,password:input.password,businessId:authStorage.getSession()?.businessId,branchId:authStorage.getSession()?.branchId}]);await queueOfflineAdminMutation({entity:"admin_user",operation:"create",id,payload:{...input,active:true,kind:"create",created_at:now}});return {id,username:input.username,name:input.name,role:input.role,active:true,created_at:now};}}
export async function setAdminUserStatus(id:string,active:boolean){try{return await apiRequest<AdminUser>(`/admin/users/${id}/status`,{method:"PATCH",body:JSON.stringify({active})});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const users=authStorage.getUsers();const u=users.find(x=>x.id===id);if(u){u.active=active;authStorage.saveUsers(users);}await queueOfflineAdminMutation({entity:"admin_user",operation:"update",id,payload:{id,active,kind:"status"}});return {...u,active} as AdminUser;}}
export async function setAdminUserPassword(id:string,password:string){try{return await apiRequest<{ok:boolean}>(`/admin/users/${id}/password`,{method:"PATCH",body:JSON.stringify({password})});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const users=authStorage.getUsers();const u=users.find(x=>x.id===id);if(u){u.password=password;authStorage.saveUsers(users);}await queueOfflineAdminMutation({entity:"admin_user",operation:"update",id,payload:{id,password,kind:"password"}});return {ok:true};}}

export function updateVariant(productId:string, variantId:string, input: {size?:string|null;color?:string|null;barcode?:string|null;cost?:number;price?:number;qty?:number;reorderLevel?:number}) { return apiRequest<{ok:boolean;variantId:string}>(`/products/${productId}/variants/${variantId}`, {method:"PUT",body:JSON.stringify(input)}); }

export function createVariant(productId:string,input:{size?:string;color?:string;barcode?:string;cost:number;price:number;qty:number;reorderLevel:number}){return apiRequest<{variantId:string}>(`/products/${productId}/variants`,{method:"POST",body:JSON.stringify(input)});}

export async function adjustInventory(input:{variantId:string;quantityDelta:number;reason:"Damaged"|"Missing"|"Physical Count"|"Correction"|"Other";note?:string;date?:string}){
  try{return await apiRequest<{id:string;quantity:number}>("/inventory/adjustments",{method:"POST",body:JSON.stringify(input)});}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const id=crypto.randomUUID();
    await queueOfflineInventoryAdjustment({id,...input});
    const rows=await offlineQuery<{qty:number}>("SELECT qty FROM products WHERE id=?",[input.variantId]);
    return {id,quantity:Number(rows[0]?.qty||0)};
  }
}

export async function getInventoryAdjustments(variantId:string){return apiRequest<any[]>(`/inventory/adjustments?variantId=${encodeURIComponent(variantId)}`)}
export async function updateInventoryAdjustment(id:string,input:{quantityDelta:number;reason:string;note?:string;date?:string}){return apiRequest<{ok:boolean;quantity:number}>(`/inventory/adjustments/${id}`,{method:"PUT",body:JSON.stringify(input)})}
export async function createStockTransfer(input:{toBranchId:string;items:{variantId:string;quantity:number}[]}){const id=crypto.randomUUID();try{return await apiRequest<{id:string;status:string}>("/inventory/transfers",{method:"POST",body:JSON.stringify({...input,id})});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineStockTransfer({id,...input});return {id,status:"sent"};}}

export type Branch={id:string;name:string;code:string};
export async function getBranches(){try{const b=await apiRequest<Branch[]>("/branches");if(electronOffline())for(const x of b)await offlineExec("INSERT INTO branches(id,name,code) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code",[x.id,x.name,x.code]);return b;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return offlineQuery<Branch>("SELECT id,name,code FROM branches ORDER BY name");}}
export async function createBranch(input:{name:string;code:string}){try{return await apiRequest<Branch>("/branches",{method:"POST",body:JSON.stringify(input)});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const id=crypto.randomUUID();const b={id,name:input.name,code:input.code};await queueOfflineBranch(b);return b;}}
export async function receiveStockTransfer(id:string){try{return await apiRequest<{id:string;status:string}>(`/inventory/transfers/${id}/receive`,{method:"POST"});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineTransferReceive(id);return {id,status:"received"};}}

export async function getStockTransfers(){try{return await apiRequest<any[]>("/inventory/transfers");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return getCachedStockTransfers();}}

export async function getPurchases(){try{return await apiRequest<any[]>("/purchases");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const rows=await offlineQuery<any>("SELECT id,invoice_no,supplier_id,total,payment_method,paid_amount,created_at FROM purchases ORDER BY created_at DESC");return rows.map((p:any)=>({id:p.id,invoice_no:p.invoice_no,supplier_id:p.supplier_id,total:Number(p.total),payment_method:p.payment_method,paid_amount:Number(p.paid_amount),purchase_date:p.created_at}));}}

export type Supplier={id:string;name:string;phone?:string|null;address?:string|null;balance?:number};
export async function getSuppliers(){try{const suppliers=await apiRequest<Supplier[]>("/suppliers");if(electronOffline()){await offlineExec("CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,address TEXT,balance REAL NOT NULL DEFAULT 0)");for(const s of suppliers)await offlineExec("INSERT INTO suppliers(id,name,phone,address,balance) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,address=excluded.address,balance=excluded.balance",[s.id,s.name,s.phone??null,s.address??null,Number(s.balance??0)]);}return suppliers;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await offlineExec("CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,address TEXT,balance REAL NOT NULL DEFAULT 0)");return offlineQuery<Supplier>("SELECT id,name,phone,address,balance FROM suppliers ORDER BY name");}}
export async function recordSupplierPayment(id:string,amount:number,note?:string){
  try{return await apiRequest<{supplierId:string;balance:number}>(`/suppliers/${id}/payment`,{method:"POST",body:JSON.stringify({amount,note})});}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    const paymentId=crypto.randomUUID();
    await queueOfflineSupplierPayment({id:paymentId,supplierId:id,amount,note});
    const rows=await offlineQuery<{balance:number}>("SELECT balance FROM suppliers WHERE id=?",[id]);
    return {supplierId:id,balance:Number(rows[0]?.balance||0)};
  }
}
export type SupplierTransaction={id:string;type:"purchase"|"payment";amount:number;reference_id?:string|null;note?:string|null;created_at:string};
export async function getSupplierTransactions(id:string){try{return await apiRequest<SupplierTransaction[]>(`/suppliers/${id}/transactions`);}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return offlineQuery<SupplierTransaction>("SELECT id,type,amount,reference_id,note,created_at FROM supplier_transactions WHERE supplier_id=? ORDER BY created_at DESC",[id]);}}
export async function createSupplier(input:{name:string;phone?:string;address?:string}){try{return await apiRequest<Supplier>("/suppliers",{method:"POST",body:JSON.stringify(input)});}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const id=crypto.randomUUID();await queueOfflineSupplier({id,...input});return {id,name:input.name,phone:input.phone||null,address:input.address||null,balance:0};}}

export type InventorySummary={product_id:string;name:string;sku:string;variant_id:string;size:string|null;color:string|null;barcode:string|null;quantity:number;cost:number;price:number;reorder_level:number};
export async function getInventorySummary(){try{return await apiRequest<InventorySummary[]>("/inventory/summary");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return offlineQuery<InventorySummary>("SELECT id AS product_id,name,sku,id AS variant_id,size,color,barcode,qty AS quantity,cost,price,reorder_level FROM products ORDER BY name");}}
export type StockMovementRow={id:string;branch_id:string;variant_id:string;type:string;quantity:number;reason:string|null;reference_id:string|null;created_at:string;name:string;sku:string;size:string|null;color:string|null};
export async function getInventoryMovements(){try{return await apiRequest<StockMovementRow[]>("/inventory/movements");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return offlineQuery<StockMovementRow>("SELECT sm.id,'' AS branch_id,sm.product_id AS variant_id,sm.type,sm.quantity,sm.reason,sm.reference_id,sm.created_at,p.name,p.sku,p.size,p.color FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id ORDER BY sm.created_at DESC");}}

export type ApiReturnRecord={id:string;type:string;sale_id:string;refund_amount:number;price_difference:number;created_at:string};
export async function getReturns(){try{return await apiRequest<ApiReturnRecord[]>("/returns");}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await offlineExec("CREATE TABLE IF NOT EXISTS returns (id TEXT PRIMARY KEY,type TEXT NOT NULL,sale_id TEXT NOT NULL,refund_amount REAL NOT NULL DEFAULT 0,price_difference REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL)");return offlineQuery<ApiReturnRecord>("SELECT id,type,sale_id,refund_amount,price_difference,created_at FROM returns ORDER BY created_at DESC");}}

export type CustomerTransactionRow={id:string;customer_id:string;type:string;amount:number;note:string|null;created_at:string};
export async function getCustomerTransactions(customerId:string){try{return await apiRequest<CustomerTransactionRow[]>(`/customers/${customerId}/transactions`);}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await offlineExec("CREATE TABLE IF NOT EXISTS customer_transactions (id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,type TEXT NOT NULL,amount REAL NOT NULL,note TEXT,created_at TEXT NOT NULL)");return offlineQuery<CustomerTransactionRow>("SELECT id,customer_id,type,amount,note,created_at FROM customer_transactions WHERE customer_id=? ORDER BY created_at DESC",[customerId]);}}

export type OfflineStockDifference={variant_id:string;name:string;sku:string;size:string|null;color:string|null;server_quantity:number;local_quantity:number|null;difference:number};
export function reconcileOfflineStock(items:{variantId:string;quantity:number}[]){return apiRequest<{checked:number;differences:OfflineStockDifference[]}>("/inventory/reconcile-offline",{method:"POST",body:JSON.stringify({items})});}

export type RawMaterial={id:string;name:string;supplierId:string|null;supplier?:string|null;unit:string;quantity:number;cost:number;location:string|null;created_at:string};
export type FabricLot={id:string;rawMaterialId:string;rawMaterial?:string;lotNumber:string;meterQuantity:number;cost:number;location:string|null;created_at:string};
export type CmtJob={id:string;supplierId:string|null;supplier?:string|null;fabricLotId:string|null;lotNumber?:string|null;metersSent:number;piecesReceived:number;jobDate:string;status:"open"|"sent"|"received"|"closed";notes:string|null;created_at:string};
export async function getRawMaterials(){
  try{return await apiRequest<RawMaterial[]>("/garments/raw-materials");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    await offlineExec("CREATE TABLE IF NOT EXISTS raw_materials (id TEXT PRIMARY KEY,name TEXT NOT NULL,supplier_id TEXT,unit TEXT NOT NULL,quantity REAL NOT NULL DEFAULT 0,cost REAL NOT NULL DEFAULT 0,location TEXT,created_at TEXT NOT NULL)");
    return offlineQuery<RawMaterial>("SELECT id,name,supplier_id AS supplierId,NULL AS supplier,unit,quantity,cost,location,created_at FROM raw_materials ORDER BY name");
  }
}

export async function createRawMaterial(input:{id?:string;name:string;supplierId?:string|null;unit:string;quantity:number;cost:number;location?:string|null}){const payload={...input,id:input.id||crypto.randomUUID()};try{return await apiRequest<RawMaterial>("/garments/raw-materials",{method:"POST",body:JSON.stringify(payload)})}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineRawMaterial(payload);return {...payload,created_at:new Date().toISOString()} as RawMaterial;}}
export async function getFabricLots(){
  try{return await apiRequest<FabricLot[]>("/garments/fabric-lots");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    await offlineExec("CREATE TABLE IF NOT EXISTS fabric_lots (id TEXT PRIMARY KEY,raw_material_id TEXT NOT NULL,lot_number TEXT NOT NULL,meter_quantity REAL NOT NULL DEFAULT 0,cost REAL NOT NULL DEFAULT 0,location TEXT,created_at TEXT NOT NULL)");
    return offlineQuery<FabricLot>("SELECT fl.id,fl.raw_material_id AS rawMaterialId,rm.name AS rawMaterial,fl.lot_number AS lotNumber,fl.meter_quantity AS meterQuantity,fl.cost,fl.location,fl.created_at FROM fabric_lots fl LEFT JOIN raw_materials rm ON rm.id=fl.raw_material_id ORDER BY fl.created_at DESC");
  }
}

export async function createFabricLot(input:{id?:string;rawMaterialId:string;lotNumber:string;meterQuantity:number;cost:number;location?:string|null}){const payload={...input,id:input.id||crypto.randomUUID()};try{return await apiRequest<FabricLot>("/garments/fabric-lots",{method:"POST",body:JSON.stringify(payload)})}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineFabricLot(payload);return {...payload,created_at:new Date().toISOString()} as FabricLot;}}
export async function getCmtJobs(){
  try{return await apiRequest<CmtJob[]>("/garments/cmt-jobs");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    await offlineExec("CREATE TABLE IF NOT EXISTS cmt_jobs (id TEXT PRIMARY KEY,supplier_id TEXT,fabric_lot_id TEXT,meters_sent REAL NOT NULL DEFAULT 0,pieces_received INTEGER NOT NULL DEFAULT 0,job_date TEXT NOT NULL,status TEXT NOT NULL,notes TEXT,created_at TEXT NOT NULL)");
    return offlineQuery<CmtJob>("SELECT j.id,j.supplier_id AS supplierId,s.name AS supplier,j.fabric_lot_id AS fabricLotId,fl.lot_number AS lotNumber,j.meters_sent AS metersSent,j.pieces_received AS piecesReceived,j.job_date AS jobDate,j.status,j.notes,j.created_at FROM cmt_jobs j LEFT JOIN suppliers s ON s.id=j.supplier_id LEFT JOIN fabric_lots fl ON fl.id=j.fabric_lot_id ORDER BY j.created_at DESC");
  }
}

export async function createCmtJob(input:{id?:string;supplierId?:string|null;fabricLotId?:string|null;metersSent:number;piecesReceived:number;jobDate?:string;status:CmtJob["status"];notes?:string|null}){const payload={...input,id:input.id||crypto.randomUUID()};try{return await apiRequest<CmtJob>("/garments/cmt-jobs",{method:"POST",body:JSON.stringify(payload)})}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineCmtJob(payload);return {...payload,jobDate:payload.jobDate||new Date().toISOString(),created_at:new Date().toISOString()} as CmtJob;}}
export async function updateCmtJob(id:string,input:{status:CmtJob["status"];piecesReceived?:number;notes?:string|null}){try{return await apiRequest<CmtJob>("/garments/cmt-jobs/"+id,{method:"PUT",body:JSON.stringify(input)})}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineCmtJobUpdate({id,...input});return {...input,id} as CmtJob;}}
export type FinishedStockReceipt={id:string;jobId:string;variantId:string;productName:string;sku:string;size:string|null;color:string|null;quantity:number;createdAt:string};
export async function receiveFinishedStock(input:{id?:string;jobId:string;variantId:string}){const payload={...input,id:input.id||crypto.randomUUID()};try{return await apiRequest<FinishedStockReceipt>("/garments/finished-stock",{method:"POST",body:JSON.stringify(payload)})}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const jobs=await getCmtJobs();const job=jobs.find(x=>x.id===payload.jobId);if(!job||Number(job.piecesReceived)<=0)throw new Error("CMT job is not ready offline.");const products=await getProducts();const product=products.find((x:any)=>(x.variantId||x.id)===payload.variantId);if(!product)throw new Error("Finished product is not available offline.");await queueOfflineFinishedStock({id:payload.id,jobId:payload.jobId,variantId:payload.variantId,quantity:Number(job.piecesReceived),productName:product.name,sku:product.sku,size:product.size,color:product.color});return {id:payload.id,jobId:payload.jobId,variantId:payload.variantId,productName:product.name,sku:product.sku,size:product.size,color:product.color,quantity:Number(job.piecesReceived),createdAt:new Date().toISOString()};}
}
export async function getFinishedStock(){
  try{return await apiRequest<FinishedStockReceipt[]>("/garments/finished-stock");}
  catch(error){
    if(!electronOffline()||!isNetworkFailure(error))throw error;
    await offlineExec("CREATE TABLE IF NOT EXISTS finished_stock_receipts (id TEXT PRIMARY KEY,job_id TEXT NOT NULL,variant_id TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)");
    return offlineQuery<FinishedStockReceipt>("SELECT r.id,r.job_id AS jobId,r.variant_id AS variantId,p.name AS productName,p.sku,p.size,p.color,r.quantity,r.created_at AS createdAt FROM finished_stock_receipts r LEFT JOIN products p ON p.id=r.variant_id ORDER BY r.created_at DESC");
  }
}


export type MasterType={id:string;name:string;label:string;active:boolean;builtin?:boolean};export type MasterItem={id:string;name:string;active:boolean;categoryId?:string|null};export async function getMasterTypes(){try{const r=await apiRequest<MasterType[]>("/master-data/types");await cacheOfflineMasterTypes(r);return r;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return offlineQuery<any>("SELECT id,name,label,active,builtin FROM master_data_types ORDER BY label");}}
export async function createMasterType(label:string){const input={label};try{const r=await apiRequest<MasterType>("/master-data/types",{method:"POST",body:JSON.stringify(input)});await cacheOfflineMasterTypes([r]);return r;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const id=crypto.randomUUID(),name=label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");await queueOfflineMasterMutation({entity:"master_type",operation:"create",type:name,id,name,label,active:true});return {id,name,label,active:true,builtin:false};}}
export async function updateMasterType(id:string,input:{label:string;active?:boolean}){try{const r=await apiRequest<MasterType>(`/master-data/types/${id}`,{method:"PUT",body:JSON.stringify(input)});await cacheOfflineMasterTypes([r]);return r;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const name=input.label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");await queueOfflineMasterMutation({entity:"master_type",operation:"update",type:name,id,name,label:input.label,active:input.active});return {id,name,label:input.label,active:input.active!==false,builtin:false};}}
export async function getMasterData(type:string){try{const r=await apiRequest<MasterItem[]>(`/master-data?type=${encodeURIComponent(type)}`);await cacheOfflineMasterItems(type,r);return r;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;return getCachedMasterItems(type);}}
export async function createMasterData(input:{type:string;name:string;categoryId?:string|null}){try{const r=await apiRequest<MasterItem>("/master-data",{method:"POST",body:JSON.stringify(input)});await cacheOfflineMasterItems(input.type,[r]);return r;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;const id=crypto.randomUUID();await queueOfflineMasterMutation({entity:"master_item",operation:"create",type:input.type,id,name:input.name,active:true,categoryId:input.categoryId??null});return {id,name:input.name,active:true,categoryId:input.categoryId??null};}}
export async function updateMasterData(type:string,id:string,input:{name:string;active?:boolean;categoryId?:string|null}){try{const r=await apiRequest<MasterItem>(`/master-data/${encodeURIComponent(type)}/${id}`,{method:"PUT",body:JSON.stringify(input)});await cacheOfflineMasterItems(type,[r]);return r;}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineMasterMutation({entity:"master_item",operation:"update",type,id,name:input.name,active:input.active,categoryId:input.categoryId??null});return {id,name:input.name,active:input.active!==false,categoryId:input.categoryId??null};}}

export async function deleteMasterData(type:string,id:string){try{await apiRequest<{ok:boolean}>(`/master-data/${encodeURIComponent(type)}/${id}`,{method:"DELETE"});return {ok:true};}catch(error){if(!electronOffline()||!isNetworkFailure(error))throw error;await queueOfflineMasterMutation({entity:"master_item",operation:"delete",type,id,name:"",active:false});return {ok:true};}}