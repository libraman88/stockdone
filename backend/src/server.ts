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

app.get("/api/branches",authenticate,async(req,res)=>{const r=await pool.query("SELECT id,name,code FROM branches WHERE business_id=$1 ORDER BY name",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)});
app.post("/api/branches",authenticate,requirePermission("admin"),async(req,res)=>{const s=z.object({name:z.string().min(1),code:z.string().min(1).max(20)}).safeParse(req.body);if(!s.success)return res.status(400).json({error:"Invalid branch"});try{const r=await pool.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,$3,$4) RETURNING id,name,code",[crypto.randomUUID(),process.env.DEFAULT_BUSINESS_ID,s.data.name,s.data.code.toUpperCase()]);res.status(201).json(r.rows[0])}catch(e){res.status(409).json({error:"Branch code already exists or branch could not be created"})}});
app.post("/api/inventory/transfers/:id/receive",authenticate,requirePermission("inventory"),async(req,res)=>{const client=await pool.connect();try{await client.query("BEGIN");const t=await client.query("SELECT id,from_branch_id,to_branch_id,status FROM stock_transfers WHERE id=$1 AND business_id=$2 FOR UPDATE",[req.params.id,process.env.DEFAULT_BUSINESS_ID]);if(!t.rowCount)throw new Error("TRANSFER_NOT_FOUND");if(t.rows[0].status!=="sent")throw new Error("TRANSFER_NOT_RECEIVABLE");const items=await client.query("SELECT variant_id,quantity FROM stock_transfer_items WHERE transfer_id=$1",[req.params.id]);for(const item of items.rows){await client.query("INSERT INTO inventory(id,branch_id,variant_id,quantity,reorder_level) VALUES($1,$2,$3,$4,5) ON CONFLICT(branch_id,variant_id) DO UPDATE SET quantity=inventory.quantity+EXCLUDED.quantity",[crypto.randomUUID(),t.rows[0].to_branch_id,item.variant_id,item.quantity]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reason,reference_id) VALUES($1,$2,$3,'transfer_in',$4,'Branch transfer received',$5)",[crypto.randomUUID(),t.rows[0].to_branch_id,item.variant_id,item.quantity,req.params.id]);}await client.query("UPDATE stock_transfers SET status='received',received_at=now() WHERE id=$1",[req.params.id]);await client.query("COMMIT");res.json({id:req.params.id,status:"received"})}catch(e){await client.query("ROLLBACK");res.status(e instanceof Error&&e.message.startsWith("TRANSFER_")?409:500).json({error:e instanceof Error?e.message:"Receive failed"})}finally{client.release()}});
app.get("/api/products",async(_req,res)=>{
  try{const {rows}=await pool.query("SELECT p.id,p.name,p.sku,p.category_id,v.id AS variant_id,v.size,v.color,v.barcode,v.cost,v.price,COALESCE(i.quantity,0) AS qty,COALESCE(i.reorder_level,5) AS reorder_level FROM products p LEFT JOIN product_variants v ON v.product_id=p.id LEFT JOIN inventory i ON i.variant_id=v.id");res.json(rows)}
  catch{res.status(500).json({error:"Unable to load products"})}
});


const productSchema=z.object({id:z.string().uuid().optional(),name:z.string().min(1),sku:z.string().min(1),categoryId:z.string().uuid().nullable().optional(),size:z.string().nullable().optional(),color:z.string().nullable().optional(),barcode:z.string().nullable().optional(),cost:z.number().nonnegative(),price:z.number().nonnegative(),qty:z.number().int().nonnegative().default(0),reorderLevel:z.number().int().nonnegative().default(5)});
app.post("/api/products",async(req,res)=>{const parsed=productSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid product data"});const x=parsed.data;const client=await pool.connect();try{await client.query("BEGIN");const productId=x.id||crypto.randomUUID();await client.query("INSERT INTO products(id,business_id,name,sku,category_id) VALUES($1,$2,$3,$4,$5)",[productId,process.env.DEFAULT_BUSINESS_ID||crypto.randomUUID(),x.name,x.sku,x.categoryId||null]);const variantId=crypto.randomUUID();await client.query("INSERT INTO product_variants(id,product_id,size,color,barcode,cost,price) VALUES($1,$2,$3,$4,$5,$6,$7)",[variantId,productId,x.size||null,x.color||null,x.barcode||null,x.cost,x.price]);if(process.env.DEFAULT_BRANCH_ID)await client.query("INSERT INTO inventory(id,branch_id,variant_id,quantity,reorder_level) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,variantId,x.qty,x.reorderLevel]);await client.query("COMMIT");res.status(201).json({id:productId,variantId})}catch(e){await client.query("ROLLBACK");res.status(409).json({error:"Unable to create product"})}finally{client.release()}});
const variantSchema=z.object({productId:z.string().uuid(),size:z.string().nullable().optional(),color:z.string().nullable().optional(),barcode:z.string().nullable().optional(),cost:z.number().nonnegative(),price:z.number().nonnegative(),qty:z.number().int().nonnegative().default(0),reorderLevel:z.number().int().nonnegative().default(5)});
app.post("/api/products/:id/variants",async(req,res)=>{const p=variantSchema.safeParse({...req.body,productId:req.params.id});if(!p.success)return res.status(400).json({error:"Invalid variant data"});const x=p.data,client=await pool.connect();try{await client.query("BEGIN");const pr=await client.query("SELECT id FROM products WHERE id=$1 AND business_id=$2",[x.productId,process.env.DEFAULT_BUSINESS_ID]);if(!pr.rowCount)throw new Error("PRODUCT_NOT_FOUND");const variantId=crypto.randomUUID();await client.query("INSERT INTO product_variants(id,product_id,size,color,barcode,cost,price) VALUES($1,$2,$3,$4,$5,$6,$7)",[variantId,x.productId,x.size||null,x.color||null,x.barcode||null,x.cost,x.price]);if(process.env.DEFAULT_BRANCH_ID)await client.query("INSERT INTO inventory(id,branch_id,variant_id,quantity,reorder_level) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,variantId,x.qty,x.reorderLevel]);await client.query("COMMIT");res.status(201).json({variantId})}catch(e){await client.query("ROLLBACK");res.status(e instanceof Error&&e.message==="PRODUCT_NOT_FOUND"?404:409).json({error:e instanceof Error?e.message:"Unable to create variant"})}finally{client.release()}});
app.put("/api/products/:id",async(req,res)=>{const parsed=productSchema.partial().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid product data"});const x=parsed.data;try{const r=await pool.query("UPDATE products SET name=COALESCE($1,name),sku=COALESCE($2,sku),category_id=COALESCE($3,category_id) WHERE id=$4 RETURNING id,name,sku,category_id",[x.name,x.sku,x.categoryId||null,req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Product not found"});res.json(r.rows[0])}catch{res.status(409).json({error:"Unable to update product"})}});
app.delete("/api/products/:id",async(req,res)=>{res.status(405).json({error:"Products are archived, not hard-deleted"})});


const saleSchema=z.object({invoiceNo:z.string().min(1),paymentMethod:z.enum(["cash","card","bank","other"]),discount:z.number().nonnegative().default(0),customerId:z.string().uuid().nullable().optional(),received:z.number().nonnegative().optional(),change:z.number().nonnegative().optional(),items:z.array(z.object({variantId:z.string().uuid(),qty:z.number().int().positive(),price:z.number().nonnegative()})).min(1)});
app.use("/api/products", authenticate);
app.use("/api/sales", authenticate);
app.use("/api/purchases", authenticate);
app.use("/api/customers", authenticate);
app.use("/api/returns", authenticate);
app.use("/api/reports", authenticate);

app.get("/api/sales",authenticate,async(_req,res)=>{try{const r=await pool.query("SELECT s.id,s.invoice_no AS \"invoiceNo\",s.total,s.discount,s.payment_method AS \"paymentMethod\",s.customer_id AS \"customerId\",s.created_at AS \"createdAt\",COALESCE((SELECT json_agg(json_build_object('productId',si.variant_id,'variantId',si.variant_id,'qty',si.quantity,'price',si.unit_price)) FROM sale_items si WHERE si.sale_id=s.id),'[]'::json) AS items FROM sales s WHERE s.business_id=$1 ORDER BY s.created_at DESC LIMIT 1000",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)}catch{res.status(500).json({error:"Unable to load sales"})}});

app.post("/api/sales",async(req,res)=>{const parsed=saleSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid sale data"});const s=parsed.data;const client=await pool.connect();try{await client.query("BEGIN");let subtotal=0;for(const i of s.items){const r=await client.query("SELECT quantity FROM inventory WHERE branch_id=$1 AND variant_id=$2 FOR UPDATE",[process.env.DEFAULT_BRANCH_ID,i.variantId]);if(!r.rowCount||r.rows[0].quantity<i.qty)throw new Error("INSUFFICIENT_STOCK");subtotal+=i.qty*i.price}const total=Math.max(0,subtotal-s.discount);const saleId=crypto.randomUUID();if(s.paymentMethod==="other"&&!s.customerId)throw new Error("CUSTOMER_REQUIRED_FOR_CREDIT");if(s.customerId){const cr=await client.query("SELECT id FROM customers WHERE id=$1 AND business_id=$2 FOR UPDATE",[s.customerId,process.env.DEFAULT_BUSINESS_ID]);if(!cr.rowCount)throw new Error("CUSTOMER_NOT_FOUND");}await client.query("INSERT INTO sales(id,business_id,branch_id,invoice_no,customer_id,subtotal,discount,total,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[saleId,process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,s.invoiceNo,s.customerId||null,subtotal,s.discount,total,s.paymentMethod]);if(s.paymentMethod==="cash" && (s.received??0)<total) throw new Error("INSUFFICIENT_CASH");const received=s.paymentMethod==="cash"?(s.received??0):total;const change=s.paymentMethod==="cash"?Math.max(0,received-total):0;await client.query("INSERT INTO payments(id,business_id,branch_id,sale_id,method,amount,received,change_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[crypto.randomUUID(),process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,saleId,s.paymentMethod,total,received,change]);if(s.paymentMethod==="other"&&s.customerId){await client.query("UPDATE customers SET balance=balance+$1 WHERE id=$2",[total,s.customerId]);await client.query("INSERT INTO customer_transactions(id,customer_id,type,amount,reference_id,note) VALUES($1,$2,'credit_sale',$3,$4,$5)",[crypto.randomUUID(),s.customerId,total,saleId,"POS credit sale"]);}for(const i of s.items){await client.query("INSERT INTO sale_items(id,sale_id,variant_id,quantity,unit_price) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),saleId,i.variantId,i.qty,i.price]);await client.query("UPDATE inventory SET quantity=quantity-$1 WHERE branch_id=$2 AND variant_id=$3",[i.qty,process.env.DEFAULT_BRANCH_ID,i.variantId]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reference_id) VALUES($1,$2,$3,'sale',$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,i.variantId,-i.qty,saleId])}await client.query("COMMIT");res.status(201).json({id:saleId,invoiceNo:s.invoiceNo,total})}catch(e){await client.query("ROLLBACK");res.status(e instanceof Error&&["INSUFFICIENT_STOCK","CUSTOMER_REQUIRED_FOR_CREDIT","CUSTOMER_NOT_FOUND","INSUFFICIENT_CASH"].includes(e.message)?409:500).json({error:e instanceof Error?e.message:"Sale failed"})}finally{client.release()}});


const purchaseSchema=z.object({invoiceNo:z.string().min(1),supplierId:z.string().uuid().nullable().optional(),items:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive(),cost:z.number().nonnegative()})).min(1)});
app.post("/api/purchases",authenticate,requirePermission("purchases"),async(req,res)=>{const parsed=purchaseSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid purchase data"});const p=parsed.data;const client=await pool.connect();try{await client.query("BEGIN");const purchaseId=crypto.randomUUID();const total=p.items.reduce((n,i)=>n+i.quantity*i.cost,0);await client.query("INSERT INTO purchases(id,business_id,branch_id,supplier_id,invoice_no,total) VALUES($1,$2,$3,$4,$5,$6)",[purchaseId,process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,p.supplierId||null,p.invoiceNo,total]);for(const i of p.items){await client.query("INSERT INTO purchase_items(id,purchase_id,variant_id,quantity,cost) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),purchaseId,i.variantId,i.quantity,i.cost]);await client.query("UPDATE inventory SET quantity=quantity+$1 WHERE branch_id=$2 AND variant_id=$3",[i.quantity,process.env.DEFAULT_BRANCH_ID,i.variantId]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reference_id) VALUES($1,$2,$3,'purchase',$4,$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,i.variantId,i.quantity,purchaseId])}await client.query("COMMIT");res.status(201).json({id:purchaseId,invoiceNo:p.invoiceNo,total})}catch{await client.query("ROLLBACK");res.status(500).json({error:"Purchase failed"})}finally{client.release()}});


const supplierSchema=z.object({name:z.string().min(1),phone:z.string().optional(),address:z.string().optional()});
app.get("/api/suppliers",authenticate,requirePermission("purchases"),async(req,res)=>{const r=await pool.query("SELECT id,name,phone,address,created_at FROM suppliers WHERE business_id=$1 ORDER BY name",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)});
app.post("/api/suppliers",authenticate,requirePermission("purchases"),async(req,res)=>{const p=supplierSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid supplier"});try{const r=await pool.query("INSERT INTO suppliers(id,business_id,name,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,address,created_at",[crypto.randomUUID(),process.env.DEFAULT_BUSINESS_ID,p.data.name,p.data.phone||null,p.data.address||null]);res.status(201).json(r.rows[0])}catch{res.status(500).json({error:"Unable to create supplier"})}});
app.get("/api/purchases",authenticate,requirePermission("purchases"),async(req,res)=>{const r=await pool.query("SELECT p.id,p.invoice_no,p.purchase_date,p.total,s.name AS supplier FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.business_id=$1 ORDER BY p.purchase_date DESC LIMIT 500",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)});
const customerSchema=z.object({name:z.string().min(1),phone:z.string().optional(),address:z.string().optional()});
app.get("/api/customers",authenticate,async(_req,res)=>{try{const r=await pool.query("SELECT id,name,phone,address,balance,created_at FROM customers WHERE business_id=$1 ORDER BY name",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)}catch{res.status(500).json({error:"Unable to load customers"})}});
app.post("/api/customers",authenticate,async(req,res)=>{const p=customerSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid customer data"});try{const id=crypto.randomUUID(),r=await pool.query("INSERT INTO customers(id,business_id,name,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,address,balance",[id,process.env.DEFAULT_BUSINESS_ID,p.data.name,p.data.phone||null,p.data.address||null]);res.status(201).json(r.rows[0])}catch{res.status(500).json({error:"Unable to create customer"})}});
app.post("/api/customers/:id/payment",authenticate,async(req,res)=>{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Invalid payment amount"});const client=await pool.connect();try{await client.query("BEGIN");const r=await client.query("SELECT balance FROM customers WHERE id=$1 FOR UPDATE",[req.params.id]);if(!r.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Customer not found"});}const next=Math.max(0,Number(r.rows[0].balance)-amount);await client.query("UPDATE customers SET balance=$1 WHERE id=$2",[next,req.params.id]);await client.query("INSERT INTO customer_transactions(id,customer_id,type,amount,note) VALUES($1,$2,'payment',$3,$4)",[crypto.randomUUID(),req.params.id,amount,req.body.note||"Khata payment"]);await client.query("COMMIT");res.json({customerId:req.params.id,balance:next})}catch{await client.query("ROLLBACK");res.status(500).json({error:"Payment failed"})}finally{client.release()}});


const returnSchema=z.object({
  saleId:z.string().uuid(),
  type:z.enum(["return","exchange"]),
  refundAmount:z.number().nonnegative().default(0),
  items:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive(),unitPrice:z.number().nonnegative()})).min(1),
  exchangeItems:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive(),unitPrice:z.number().nonnegative()})).default([])
});
app.post("/api/returns",authenticate,requirePermission("returns"),async(req,res)=>{
  const p=returnSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Invalid return data"});
  const x=p.data,client=await pool.connect();
  try{
    await client.query("BEGIN");
    const sale=await client.query("SELECT id,branch_id FROM sales WHERE id=$1 AND business_id=$2 FOR UPDATE",[x.saleId,process.env.DEFAULT_BUSINESS_ID]);
    if(!sale.rowCount)throw new Error("SALE_NOT_FOUND");
    const branchId=sale.rows[0].branch_id;
    if(branchId!==process.env.DEFAULT_BRANCH_ID)throw new Error("BRANCH_MISMATCH");
    let returnedValue=0;
    for(const i of x.items){
      const sold=await client.query("SELECT si.id,si.quantity,si.unit_price FROM sale_items si WHERE si.sale_id=$1 AND si.variant_id=$2 FOR UPDATE",[x.saleId,i.variantId]);
      if(!sold.rowCount)throw new Error("ITEM_NOT_IN_SALE");
      const already=await client.query("SELECT COALESCE(SUM(ri.quantity),0) AS qty FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE r.sale_id=$1 AND ri.variant_id=$2 AND ri.direction='in'",[x.saleId,i.variantId]);
      const remaining=Number(sold.rows[0].quantity)-Number(already.rows[0].qty);
      if(i.quantity>remaining)throw new Error("RETURN_QTY_EXCEEDS_SOLD");
      returnedValue+=Number(sold.rows[0].unit_price)*i.quantity;
    }
    let exchangeValue=0;
    if(x.type==="exchange"){
      if(x.exchangeItems.length===0)throw new Error("EXCHANGE_ITEM_REQUIRED");
      for(const i of x.exchangeItems){
        const inv=await client.query("SELECT quantity FROM inventory WHERE branch_id=$1 AND variant_id=$2 FOR UPDATE",[branchId,i.variantId]);
        if(!inv.rowCount||Number(inv.rows[0].quantity)<i.quantity)throw new Error("EXCHANGE_STOCK_UNAVAILABLE");
        exchangeValue+=i.unitPrice*i.quantity;
      }
    } else if(x.exchangeItems.length) throw new Error("EXCHANGE_ITEMS_NOT_ALLOWED");
    const calculatedRefund=x.type==="return"?returnedValue:Math.max(0,returnedValue-exchangeValue);
    if(Math.abs(x.refundAmount-calculatedRefund)>0.01)throw new Error("REFUND_AMOUNT_MISMATCH");
    const priceDifference=x.type==="exchange"?Math.max(0,exchangeValue-returnedValue):0;
    const id=crypto.randomUUID();
    await client.query("INSERT INTO returns(id,business_id,branch_id,sale_id,type,refund_amount,price_difference) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,process.env.DEFAULT_BUSINESS_ID,branchId,x.saleId,x.type,calculatedRefund,priceDifference]);
    for(const i of x.items){
      await client.query("INSERT INTO return_items(id,return_id,variant_id,quantity,unit_price,direction) VALUES($1,$2,$3,$4,$5,'in')",[crypto.randomUUID(),id,i.variantId,i.quantity,i.unitPrice]);
      await client.query("UPDATE inventory SET quantity=quantity+$1 WHERE branch_id=$2 AND variant_id=$3",[i.quantity,branchId,i.variantId]);
      await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reason,reference_id) VALUES($1,$2,$3,'sale_return',$4,'Customer return',$5)",[crypto.randomUUID(),branchId,i.variantId,i.quantity,id]);
    }
    for(const i of x.exchangeItems){
      await client.query("INSERT INTO return_items(id,return_id,variant_id,quantity,unit_price,direction) VALUES($1,$2,$3,$4,$5,'out')",[crypto.randomUUID(),id,i.variantId,i.quantity,i.unitPrice]);
      await client.query("UPDATE inventory SET quantity=quantity-$1 WHERE branch_id=$2 AND variant_id=$3",[i.quantity,branchId,i.variantId]);
      await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reason,reference_id) VALUES($1,$2,$3,'exchange_out',$4,'Exchange replacement',$5)",[crypto.randomUUID(),branchId,i.variantId,-i.quantity,id]);
    }
    await client.query("COMMIT");
    res.status(201).json({id,type:x.type,refundAmount:calculatedRefund,priceDifference});
  }catch(e){
    await client.query("ROLLBACK");
    const code=e instanceof Error?e.message:"Return failed";
    const conflicts=["ITEM_NOT_IN_SALE","RETURN_QTY_EXCEEDS_SOLD","EXCHANGE_ITEM_REQUIRED","EXCHANGE_STOCK_UNAVAILABLE","EXCHANGE_ITEMS_NOT_ALLOWED","REFUND_AMOUNT_MISMATCH","BRANCH_MISMATCH"];
    res.status(code==="SALE_NOT_FOUND"?404:conflicts.includes(code)?409:500).json({error:code});
  }finally{client.release()}
});

app.post("/api/inventory/adjustments",authenticate,requirePermission("inventory"),async(req,res)=>{const s=z.object({variantId:z.string().uuid(),quantityDelta:z.number().int(),reason:z.enum(["Damaged","Missing","Physical Count","Correction","Other"]),note:z.string().optional()}).safeParse(req.body);if(!s.success||s.data.quantityDelta===0)return res.status(400).json({error:"Invalid adjustment"});const x=s.data,client=await pool.connect();try{await client.query("BEGIN");const q=await client.query("SELECT quantity FROM inventory WHERE branch_id=$1 AND variant_id=$2 FOR UPDATE",[process.env.DEFAULT_BRANCH_ID,x.variantId]);if(!q.rowCount)throw new Error("INVENTORY_NOT_FOUND");const next=Number(q.rows[0].quantity)+x.quantityDelta;if(next<0)throw new Error("INSUFFICIENT_STOCK");await client.query("UPDATE inventory SET quantity=$1 WHERE branch_id=$2 AND variant_id=$3",[next,process.env.DEFAULT_BRANCH_ID,x.variantId]);const id=crypto.randomUUID();await client.query("INSERT INTO stock_adjustments(id,business_id,branch_id,variant_id,quantity_delta,reason,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[id,process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,x.variantId,x.quantityDelta,x.reason,x.note||null,req.user?.id||null]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reason,reference_id) VALUES($1,$2,$3,'adjustment',$4,$5,$6)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,x.variantId,x.quantityDelta,x.reason,id]);await client.query("COMMIT");res.status(201).json({id,quantity:next})}catch(e){await client.query("ROLLBACK");res.status(e instanceof Error&&["INVENTORY_NOT_FOUND","INSUFFICIENT_STOCK"].includes(e.message)?409:500).json({error:e instanceof Error?e.message:"Adjustment failed"})}finally{client.release()}});
app.post("/api/inventory/transfers",authenticate,requirePermission("inventory"),async(req,res)=>{const s=z.object({toBranchId:z.string().uuid(),items:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive()})).min(1)}).safeParse(req.body);if(!s.success||s.data.toBranchId===process.env.DEFAULT_BRANCH_ID)return res.status(400).json({error:"Invalid transfer"});const x=s.data,client=await pool.connect();try{await client.query("BEGIN");const tid=crypto.randomUUID();await client.query("INSERT INTO stock_transfers(id,business_id,from_branch_id,to_branch_id,status,created_by) VALUES($1,$2,$3,$4,'sent',$5)",[tid,process.env.DEFAULT_BUSINESS_ID,process.env.DEFAULT_BRANCH_ID,x.toBranchId,req.user?.id||null]);for(const item of x.items){const q=await client.query("SELECT quantity FROM inventory WHERE branch_id=$1 AND variant_id=$2 FOR UPDATE",[process.env.DEFAULT_BRANCH_ID,item.variantId]);if(!q.rowCount||Number(q.rows[0].quantity)<item.quantity)throw new Error("INSUFFICIENT_STOCK");await client.query("UPDATE inventory SET quantity=quantity-$1 WHERE branch_id=$2 AND variant_id=$3",[item.quantity,process.env.DEFAULT_BRANCH_ID,item.variantId]);await client.query("INSERT INTO stock_transfer_items(id,transfer_id,variant_id,quantity) VALUES($1,$2,$3,$4)",[crypto.randomUUID(),tid,item.variantId,item.quantity]);await client.query("INSERT INTO stock_movements(id,branch_id,variant_id,type,quantity,reason,reference_id) VALUES($1,$2,$3,'transfer_out',$4,'Branch transfer',$5)",[crypto.randomUUID(),process.env.DEFAULT_BRANCH_ID,item.variantId,-item.quantity,tid]);}await client.query("COMMIT");res.status(201).json({id:tid,status:"sent"})}catch(e){await client.query("ROLLBACK");res.status(e instanceof Error&&e.message==="INSUFFICIENT_STOCK"?409:500).json({error:e instanceof Error?e.message:"Transfer failed"})}finally{client.release()}});
app.get("/api/inventory/transfers",authenticate,requirePermission("inventory"),async(req,res)=>{const r=await pool.query("SELECT t.id,t.status,t.created_at,t.received_at,f.name AS from_branch,to_b.name AS to_branch,COALESCE(json_agg(json_build_object('variantId',i.variant_id,'quantity',i.quantity)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM stock_transfers t JOIN branches f ON f.id=t.from_branch_id JOIN branches to_b ON to_b.id=t.to_branch_id LEFT JOIN stock_transfer_items i ON i.transfer_id=t.id WHERE t.business_id=$1 GROUP BY t.id,f.name,to_b.name ORDER BY t.created_at DESC LIMIT 200",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)});
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

app.get("/api/reports/sales",authenticate,requirePermission("reports"),async(req,res)=>{
  const from=String(req.query.from||"1970-01-01"),to=String(req.query.to||"2999-12-31");
  try{
    const r=await pool.query("SELECT DATE(s.created_at) AS date,COUNT(*)::int AS invoices,COALESCE(SUM(s.total),0)::numeric AS total,COALESCE(SUM(s.discount),0)::numeric AS discounts FROM sales s WHERE s.business_id=$1 AND s.created_at >= $2::date AND s.created_at < ($3::date + INTERVAL '1 day') GROUP BY DATE(s.created_at) ORDER BY date",[process.env.DEFAULT_BUSINESS_ID,from,to]);
    const payments=await pool.query("SELECT payment_method AS method,COUNT(*)::int AS invoices,COALESCE(SUM(total),0)::numeric AS total FROM sales WHERE business_id=$1 AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day') GROUP BY payment_method ORDER BY total DESC",[process.env.DEFAULT_BUSINESS_ID,from,to]);
    res.json({daily:r.rows,payments:payments.rows});
  }catch{res.status(500).json({error:"Unable to generate sales report"})}
});
app.get("/api/reports/products",authenticate,requirePermission("reports"),async(req,res)=>{
  const from=String(req.query.from||"1970-01-01"),to=String(req.query.to||"2999-12-31");
  try{
    const r=await pool.query("SELECT p.name,p.sku,v.size,v.color,SUM(si.quantity)::int AS units,COALESCE(SUM(si.quantity*si.unit_price),0)::numeric AS sales,COALESCE(SUM(si.quantity*si.unit_cost),0)::numeric AS cost,COALESCE(SUM(si.quantity*(si.unit_price-si.unit_cost)),0)::numeric AS gross_profit FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN product_variants v ON v.id=si.variant_id JOIN products p ON p.id=v.product_id WHERE s.business_id=$1 AND s.created_at >= $2::date AND s.created_at < ($3::date + INTERVAL '1 day') GROUP BY p.name,p.sku,v.size,v.color ORDER BY sales DESC",[process.env.DEFAULT_BUSINESS_ID,from,to]);
    res.json(r.rows);
  }catch{res.status(500).json({error:"Unable to generate product report"})}
});
app.get("/api/reports/purchases",authenticate,requirePermission("reports"),async(req,res)=>{
  const from=String(req.query.from||"1970-01-01"),to=String(req.query.to||"2999-12-31");
  try{
    const r=await pool.query("SELECT pu.invoice_no,pu.purchase_date,pu.total,s.name AS supplier FROM purchases pu LEFT JOIN suppliers s ON s.id=pu.supplier_id WHERE pu.business_id=$1 AND pu.purchase_date >= $2::date AND pu.purchase_date < ($3::date + INTERVAL '1 day') ORDER BY pu.purchase_date DESC LIMIT 1000",[process.env.DEFAULT_BUSINESS_ID,from,to]);
    res.json(r.rows);
  }catch{res.status(500).json({error:"Unable to generate purchase report"})}
});
app.get("/api/reports/khata",authenticate,requirePermission("reports"),async(_req,res)=>{
  try{
    const r=await pool.query("SELECT id,name,phone,balance,credit_limit FROM customers WHERE business_id=$1 ORDER BY balance DESC",[process.env.DEFAULT_BUSINESS_ID]);
    res.json(r.rows);
  }catch{res.status(500).json({error:"Unable to generate khata report"})}
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


const userCreateSchema=z.object({username:z.string().min(3).max(50),name:z.string().min(1).max(100),role:z.enum(["manager","cashier"]),password:z.string().min(8).max(200)});
app.get("/api/admin/users",authenticate,requirePermission("users"),async(_req,res)=>{try{const r=await pool.query("SELECT id,username,name,role,active,created_at FROM users WHERE business_id=$1 ORDER BY created_at",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)}catch{res.status(500).json({error:"Unable to load users"})}});
app.post("/api/admin/users",authenticate,requirePermission("users"),async(req,res)=>{const p=userCreateSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid user data"});try{const hash=await bcrypt.hash(p.data.password,12);const id=crypto.randomUUID();const r=await pool.query("INSERT INTO users(id,business_id,username,name,role,password_hash,active) VALUES($1,$2,$3,$4,$5,$6,true) RETURNING id,username,name,role,active,created_at",[id,process.env.DEFAULT_BUSINESS_ID,p.data.username,p.data.name,p.data.role,hash]);await audit(req,"user.create","user",id,{username:p.data.username,role:p.data.role});res.status(201).json(r.rows[0])}catch(e){if(String(e).includes("users_username_key")||String(e).includes("duplicate"))return res.status(409).json({error:"Username already exists"});res.status(500).json({error:"Unable to create user"})}});
app.patch("/api/admin/users/:id/status",authenticate,requirePermission("users"),async(req,res)=>{const p=z.object({active:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid status"});try{if(req.params.id===req.user?.sub&&p.data.active===false)return res.status(400).json({error:"You cannot disable your own account"});const r=await pool.query("UPDATE users SET active=$1 WHERE id=$2 AND business_id=$3 RETURNING id,username,name,role,active",[p.data.active,req.params.id,process.env.DEFAULT_BUSINESS_ID]);if(!r.rowCount)return res.status(404).json({error:"User not found"});await audit(req,"user.status","user",req.params.id,{active:p.data.active});res.json(r.rows[0])}catch{res.status(500).json({error:"Unable to update user"})}});
app.patch("/api/admin/users/:id/password",authenticate,requirePermission("users"),async(req,res)=>{const p=z.object({password:z.string().min(8).max(200)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Password must be at least 8 characters"});try{const hash=await bcrypt.hash(p.data.password,12);const r=await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2 AND business_id=$3 RETURNING id",[hash,req.params.id,process.env.DEFAULT_BUSINESS_ID]);if(!r.rowCount)return res.status(404).json({error:"User not found"});await audit(req,"user.password","user",req.params.id);res.json({ok:true})}catch{res.status(500).json({error:"Unable to change password"})}});

const loginSchema=z.object({username:z.string().min(1),password:z.string().min(1)});
app.post("/api/auth/login",async(req,res)=>{const p=loginSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid credentials"});try{const r=await pool.query("SELECT id,username,name,role,password_hash,active FROM users WHERE business_id=$1 AND username=$2 LIMIT 1",[process.env.DEFAULT_BUSINESS_ID,p.data.username]);if(!r.rowCount||!r.rows[0].active||!(await bcrypt.compare(p.data.password,r.rows[0].password_hash)))return res.status(401).json({error:"Invalid username or password"});const u=r.rows[0],token=jwt.sign({sub:u.id,role:u.role,username:u.username},JWT_SECRET,{expiresIn:"8h"});res.json({token,user:{id:u.id,username:u.username,name:u.name,role:u.role}})}catch{res.status(500).json({error:"Login failed"})}});
app.get("/api/auth/me",authenticate,(req:any,res)=>res.json({user:req.user}));


async function audit(req:any,action:string,entity?:string,entityId?:string,details?:unknown){try{await pool.query("INSERT INTO audit_logs(id,business_id,user_id,action,entity,entity_id,details,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[crypto.randomUUID(),process.env.DEFAULT_BUSINESS_ID,req.user?.sub||null,action,entity||null,entityId||null,details?JSON.stringify(details):null,req.ip||null])}catch{}}
app.get("/api/audit-logs",authenticate,requirePermission("reports"),async(req:any,res)=>{try{const r=await pool.query("SELECT id,user_id,action,entity,entity_id,details,created_at FROM audit_logs WHERE business_id=$1 ORDER BY created_at DESC LIMIT 200",[process.env.DEFAULT_BUSINESS_ID]);res.json(r.rows)}catch{res.status(500).json({error:"Unable to load audit logs"})}});

const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`StockDone API listening on :${port}`));
