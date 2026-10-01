import type { InvoiceSettings } from "./types";

const KEY="stockdone.invoice.settings";
const defaults:InvoiceSettings={businessName:"StockDone Store",phone:"",address:"",footer:"Thank you for shopping with us.",paper:"80mm",printerName:""};

export const settingsStorage={
 get:():InvoiceSettings=>{try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||"{}")}}catch{return defaults}},
 save:(v:InvoiceSettings)=>localStorage.setItem(KEY,JSON.stringify(v))
};
