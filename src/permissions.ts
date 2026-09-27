import { authStorage, type Role } from "./auth";

export const permissionForNav:Record<string,string>={
"Sales / POS":"sales","Products":"products","Inventory":"inventory","Purchases":"purchases",
"Customers / Khata":"customers","Returns / Exchange":"returns","Sales History":"sales",
"Reports":"reports","Users & Roles":"users","Settings":"settings"
};
export function canOpen(role:Role,nav:string){if(role==="owner")return true; if(nav==="Users & Roles"||nav==="Settings")return false; const p=permissionForNav[nav]; return !p||authStorage.can(role,p);}
