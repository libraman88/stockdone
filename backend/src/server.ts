import "dotenv/config";
import express from "express";
import cors from "cors";
import { Pool } from "pg";
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
\nconst port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`StockDone API listening on :${port}`));
