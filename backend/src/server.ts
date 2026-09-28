import "dotenv/config";
import express from "express";
import cors from "cors";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { z } from "zod";

const app=express();
app.use(cors());
app.use(express.json({limit:"2mb"}));

const pool=new Pool({connectionString:process.env.DATABASE_URL});
app.get("/api/health",async(_req,res)=>{
  try{await pool.query("SELECT 1");res.json({ok:true,service:"stockdone-api",database:"connected"})}
  catch{res.status(503).json({ok:false,service:"stockdone-api",database:"unavailable"})}
});

app.get("/api/products",async(_req,res)=>{
  try{const {rows}=await pool.query("SELECT p.id,p.name,p.sku,p.category_id,v.id AS variant_id,v.size,v.color,v.barcode,v.cost,v.price,COALESCE(i.quantity,0) AS qty,COALESCE(i.reorder_level,5) AS reorder_level FROM products p LEFT JOIN product_variants v ON v.product_id=p.id LEFT JOIN inventory i ON i.variant_id=v.id");res.json(rows)}
  catch{res.status(500).json({error:"Unable to load products"})}
});


const productSchema=z.object({id:z.string().uuid().optional(),name:z.string().min(1),sku:z.string().min(1),categoryId:z.string().uuid().nullable().optional(),size:z.string().nullable().optional(),color:z.string().nullable().optional(),barcode:z.string().nullable().optional(),cost:z.number().nonnegative(),price:z.number().nonnegative(),qty:z.number().int().nonnegative().default(0),reorderLevel:z.number().int().nonnegative().default(5)});
app.post("/api/products",async(req,res)=>{const parsed=productSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid product data"});const x=parsed.data;const client=await pool.connect();try{await client.query("BEGIN");const productId=x.id||crypto.randomUUID();await client.query("INSERT INTO products(id,business_id,name,sku,category_id) VALUES($1,$2,$3,$4,$5)",[productId,process.env.DEFAULT_BUSINESS_ID||crypto.randomUUID(),x.name,x.sku,x.categoryId||null]);const variantId=crypto.randomUUID();await client.query("INSERT INTO product_variants(id,product_id,size,color,barcode,cost,price) VALUES($1,$2,$3,$4,$5,$6,$7)",[variantId,productId,x.size||null,x.color||null,x.barcode||null,x.cost,x.price]);if(process.env.DEFAULT_BRANCH_ID)await client.query("INSERT INTO inventory(id,branch_id,variant_id,quantity,reorder_level) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,variantId,x.qty,x.reorderLevel]);await client.query("COMMIT");res.status(201).json({id:productId,variantId})}catch(e){await client.query("ROLLBACK");res.status(409).json({error:"Unable to create product"})}finally{client.release()}});
app.put("/api/products/:id",async(req,res)=>{const parsed=productSchema.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid product data"});const x=parsed.data;try{const r=await pool.query("UPDATE products SET name=COALESCE($1,name),sku=COALESCE($2,sku),category_id=COALESCE($3,category_id) WHERE id=$4 RETURNING id,name,sku,category_id",[x.name,x.sku,x.categoryId||null,req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Product not found"});res.json(r.rows[0])}catch{res.status(409).json({error:"Unable to update product"})}});
app.delete("/api/products/:id",async(req,res)=>{res.status(405).json({error:"Products are archived, not hard-deleted"})});


const saleSchema=z.object({invoiceNo:z.string().min(1),paymentMethod:z.enum(["cash","card","bank","other"]),discount:z.number().nonnegative().default(0),customerId:z.string().uuid().nullable().optional(),items:z.array(z.object({variantId:z.string().uuid(),qty:z.number().int().positive(),price:z.number().nonnegative()})).min(1)});
app.use("/api/products", authenticate);
app.use("/api/sales", authenticate);
app.use("/api/purchases", authenticate);
app.use("/api/customers", authenticate);
app.use("/api/returns", authenticate);
app.use("/api/reports", authenticate);

app.get("/api/sales",authenticate,async(_req,res)=>{try{const r=await pool.query("SELECT id,invoice_no AS \"invoiceNo\",total,discount,payment_method AS \"paymentMethod\",customer_id AS \"customerId\",created_at AS \"createdAt\" FROM sales WHERE business_id=$1 ORDER BY created_at DESC LIMIT 1000",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)}catch{res.status(500).json({error:"Unable to load sales"})}});

app.post("/api/sales",async(req,res)=>{const parsed=saleSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid sale data"});const s=parsed.data;const client=await pool.connect();try{await client.query("BEGIN");let subtotal=0;for(const i of s.items){const r=await client.query("SELECT quantity FROM inventory WHERE branch_id=$1 AND variant_id=$2 FOR UPDATE",[process.env.DEFAULT_BRANCH_ID,i.variantId]);if(!r.rowCount||r.rows[0].quantity<i.qty)throw new Error("INSUFFICIENT_STOCK");subtotal+=i.qty*i.price}const total=Math.max(0,subtotal-s.discount);const saleId=crypto.randomUUID();await client.query("INSERT INTO sales(id,business_id,branch_id,invoice_no,customer_id,subtotal,discount,total,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[saleId,process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,s.invoiceNo,s.customerId||null,subtotal,s.discount,total,s.paymentMethod]);for(const i of s.items){await client.query("INSERT INTO sale_items(id,sale_id,variant_id,quantity,unit_price) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),saleId,i.variantId,i.qty,i.price]);await client.query("UPDATE inventory SET quantity=quantity-$1 WHERE branch_id=$2 AND variant_id=$3",[i.qty,process.env.DEFAULT_BRANCH_ID,i.variantId]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reference_id) VALUES($1,$2,$3,'sale',$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,i.variantId,-i.qty,saleId])}await client.query("COMMIT");res.status(201).json({id:saleId,invoiceNo:s.invoiceNo,total})}catch(e){await client.query("ROLLBACK");res.status(e instanceof Error&&e.message==="INSUFFICIENT_STOCK"?409:500).json({error:e instanceof Error?e.message:"Sale failed"})}finally{client.release()}});


const purchaseSchema=z.object({invoiceNo:z.string().min(1),supplierId:z.string().uuid().nullable().optional(),items:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive(),cost:z.number().nonnegative()})).min(1)});
app.post("/api/purchases",async(req,res)=>{const parsed=purchaseSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid purchase data"});const p=parsed.data;const client=await pool.connect();try{await client.query("BEGIN");const purchaseId=crypto.randomUUID();const total=p.items.reduce((n,i)=>n+i.quantity*i.cost,0);await client.query("INSERT INTO purchases(id,business_id,branch_id,supplier_id,invoice_no,total) VALUES($1,$2,$3,$4,$5,$6)",[purchaseId,process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,p.supplierId||null,p.invoiceNo,total]);for(const i of p.items){await client.query("INSERT INTO purchase_items(id,purchase_id,variant_id,quantity,cost) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),purchaseId,i.variantId,i.quantity,i.cost]);await client.query("UPDATE inventory SET quantity=quantity+$1 WHERE branch_id=$2 AND variant_id=$3",[i.quantity,process.env.DEFAULT_BRANCH_ID,i.variantId]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reference_id) VALUES($1,$2,$3,'purchase',$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,i.variantId,i.quantity,purchaseId])}await client.query("COMMIT");res.status(201).json({id:purchaseId,invoiceNo:p.invoiceNo,total})}catch{await client.query("ROLLBACK");res.status(500).json({error:"Purchase failed"})}finally{client.release()}});


const customerSchema=z.object({name:z.string().min(1),phone:z.string().optional(),address:z.string().optional()});
app.get("/api/customers",authenticate,async(_req,res)=>{try{const r=await pool.query("SELECT id,name,phone,address,balance,created_at FROM customers WHERE business_id=$1 ORDER BY name",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)}catch{res.status(500).json({error:"Unable to load customers"})}});
app.post("/api/customers",authenticate,async(req,res)=>{const p=customerSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid customer data"});try{const id=crypto.randomUUID(),r=await pool.query("INSERT INTO customers(id,business_id,name,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,address,balance",[id,process.env.DEFAULT_BUSINESS_ID,p.data.name,p.data.phone||null,p.data.address||null]);res.status(201).json(r.rows[0])}catch{res.status(500).json({error:"Unable to create customer"})}});
app.post("/api/customers/:id/payment",authenticate,async(req,res)=>{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Invalid payment amount"});const client=await pool.connect();try{await client.query("BEGIN");const r=await client.query("SELECT balance FROM customers WHERE id=$1 FOR UPDATE",[req.params.id]);if(!r.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Customer not found"});}const next=Math.max(0,Number(r.rows[0].balance)-amount);await client.query("UPDATE customers SET balance=$1 WHERE id=$2",[next,req.params.id]);await client.query("INSERT INTO customer_transactions(id,customer_id,type,amount,note) VALUES($1,$2,'payment',$3,$4)",[crypto.randomUUID(),req.params.id,amount,req.body.note||"Khata payment"]);await client.query("COMMIT");res.json({customerId:req.params.id,balance:next})}catch{await client.query("ROLLBACK");res.status(500).json({error:"Payment failed"})}finally{client.release()}});


const returnSchema=z.object({saleId:z.string().uuid(),type:z.enum(["return","exchange"]),refundAmount:z.number().nonnegative().default(0),items:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive(),unitPrice:z.number().nonnegative()})).min(1)});
app.post("/api/returns",authenticate,async(req,res)=>{const p=returnSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid return data"});const x=p.data,client=await pool.connect();try{await client.query("BEGIN");const r=await client.query("SELECT id,branch_id FROM sales WHERE id=$1 FOR UPDATE",[x.saleId]);if(!r.rowCount)throw new Error("SALE_NOT_FOUND");const id=crypto.randomUUID();await client.query("INSERT INTO returns(id,business_id,branch_id,sale_id,type,refund_amount) VALUES($1,$2,$3,$4,$5,$6)",[id,process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,x.saleId,x.type,x.refundAmount]);for(const i of x.items){await client.query("INSERT INTO return_items(id,return_id,variant_id,quantity,unit_price) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),id,i.variantId,i.quantity,i.unitPrice]);await client.query("UPDATE inventory SET quantity=quantity+$1 WHERE branch_id=$2 AND variant_id=$3",[i.quantity,process.env.DEFAULT_BRANCH_ID,i.variantId]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reference_id) VALUES($1,$2,$3,'sale_return',$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,i.variantId,i.quantity,id])}await client.query("COMMIT");res.status(201).json({id,type:x.type,refundAmount:x.refundAmount})}catch(e){await client.query("ROLLBACK");res.status(e instanceof Error&&e.message==="SALE_NOT_FOUND"?404:500).json({error:e instanceof Error?e.message:"Return failed"})}finally{client.release()}});


app.get("/api/reports/summary",authenticate,async(req,res)=>{
  const from=String(req.query.from||"1970-01-01"),to=String(req.query.to||"2999-12-31");
  try{
    const sales=await pool.query("SELECT COUNT(*)::int AS invoices,COALESCE(SUM(total),0)::numeric AS sales_total,COALESCE(SUM(discount),0)::numeric AS discounts FROM sales WHERE business_id=$1 AND created_at >= $2::timestamptz AND created_at < ($3::date + INTERVAL '1 day')",[process.env.DEFAULT_BUSINESS_ID,from,to]);
    const profit=await pool.query("SELECT COALESCE(SUM(si.quantity*(si.unit_price-pv.cost)),0)::numeric AS gross_profit FROM sales s JOIN sale_items si ON si.sale_id=s.id JOIN product_variants pv ON pv.id=si.variant_id WHERE s.business_id=$1 AND s.created_at >= $2::timestamptz AND s.created_at < ($3::date + INTERVAL '1 day')",[process.env.DEFAULT_BUSINESS_ID,from,to]);
    const inventory=await pool.query("SELECT COUNT(*)::int AS variants,COALESCE(SUM(i.quantity),0)::int AS units,COALESCE(SUM(i.quantity*pv.cost),0)::numeric AS cost_value,COALESCE(SUM(i.quantity*pv.price),0)::numeric AS retail_value FROM inventory i JOIN product_variants pv ON pv.id=i.variant_id JOIN branches b ON b.id=i.branch_id WHERE b.business_id=$1",[process.env.DEFAULT_BUSINESS_ID]);
    const low=await pool.query("SELECT p.name,p.sku,v.size,v.color,i.quantity,i.reorder_level FROM inventory i JOIN product_variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id JOIN branches b ON b.id=i.branch_id WHERE b.business_id=$1 AND i.quantity<=i.reorder_level ORDER BY i.quantity ASC",[process.env.DEFAULT_BUSINESS_ID]);
    res.json({sales:sales.rows[0],profit:profit.rows[0],inventory:inventory.rows[0],lowStock:low.rows});
  }catch{res.status(500).json({error:"Unable to generate report"})}
});


const JWT_SECRET=process.env.JWT_SECRET;
if(!JWT_SECRET) throw new Error("JWT_SECRET is required");

const rolePermissions:Record<string,string[]>={owner:["*"],manager:["sales","products","inventory","purchases","customers","returns","reports"],cashier:["sales","customers","print"]};

function authenticate(req:any,res:any,next:any){
  const raw=String(req.headers.authorization||"");
  if(!raw.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required"});
  try{req.user=jwt.verify(raw.slice(7),JWT_SECRET);next()}
  catch{return res.status(401).json({error:"Invalid or expired session"})}
}
function requirePermission(permission:string){
  return (req:any,res:any,next:any)=>{
    const role=String(req.user?.role||"");
    const allowed=rolePermissions[role]||[];
    if(!allowed.includes("*")&&!allowed.includes(permission)) return res.status(403).json({error:"Permission denied"});
    next();
  };
}
app.use("/api/admin",authenticate,requirePermission("admin"),(_req,res)=>res.status(501).json({error:"Admin API not implemented"}));


const loginSchema=z.object({username:z.string().min(1),password:z.string().min(1)});
app.post("/api/auth/login",async(req,res)=>{const p=loginSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid credentials"});try{const r=await pool.query("SELECT id,username,name,role,password_hash,active FROM users WHERE business_id=$1 AND username=$2 LIMIT 1",[process.env.DEFAULT_BUSINESS_ID,p.data.username]);if(!r.rowCount||!r.rows[0].active||!(await bcrypt.compare(p.data.password,r.rows[0].password_hash)))return res.status(401).json({error:"Invalid username or password"});const u=r.rows[0],token=jwt.sign({sub:u.id,role:u.role,username:u.username},JWT_SECRET,{expiresIn:"8h"});res.json({token,user:{id:u.id,username:u.username,name:u.name,role:u.role}})}catch{res.status(500).json({error:"Login failed"})}});
app.get("/api/auth/me",authenticate,(req:any,res)=>res.json({user:req.user}));


async function audit(req:any,action:string,entity?:string,entityId?:string,details?:unknown){try{await pool.query("INSERT INTO audit_logs(id,business_id,user_id,action,entity,entity_id,details,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[crypto.randomUUID(),process.env.DEFAULT_BUSINESS_ID,req.user?.sub||null,action,entity||null,entityId||null,details?JSON.stringify(details):null,req.ip||null])}catch{}}
app.get("/api/audit-logs",authenticate,requirePermission("reports"),async(req:any,res)=>{try{const r=await pool.query("SELECT id,user_id,action,entity,entity_id,details,created_at FROM audit_logs WHERE business_id=$1 ORDER BY created_at DESC LIMIT 200",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)}catch{res.status(500).json({error:"Unable to load audit logs"})}});

const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`StockDone API listening on :${port}`));
