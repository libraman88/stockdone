export type Role = "owner" | "manager" | "cashier";
export type User = { id:string; username:string; name:string; role:Role; active:boolean };

const KEY="stockdone.users";
const DEFAULT:User[]=[{id:"owner",username:"admin",name:"Owner",role:"owner",active:true}];

export const authStorage={
 getUsers:():User[]=>{try{return JSON.parse(localStorage.getItem(KEY)||"null")||DEFAULT}catch{return DEFAULT}},
 saveUsers:(v:User[])=>localStorage.setItem(KEY,JSON.stringify(v)),
 can:(role:Role,permission:string)=>{
  const all:Record<Role,string[]>={owner:["*"],manager:["sales","products","inventory","purchases","customers","returns","reports"],cashier:["sales","customers","print"]};
  return all[role].includes("*")||all[role].includes(permission);
 }
};
