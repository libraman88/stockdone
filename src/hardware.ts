export function handleScannerInput(value:string,onScan:(code:string)=>void){const code=value.trim().replace(/[\r\n]+$/,"");if(code)onScan(code)}
export type PrinterPaper="80mm"|"A4";
export function printerSettings(paper:PrinterPaper){return {paper,thermal:paper==="80mm"}}
