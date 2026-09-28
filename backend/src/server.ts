import "dotenv/config";
import express from "express";
import cors from "cors";
import { Pool } from "pg";

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

const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`StockDone API listening on :${port}`));
