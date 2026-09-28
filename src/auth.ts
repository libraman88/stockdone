export type Role = "owner" | "manager" | "cashier";
export type User = { id:string; username:string; name:string; role:Role; active:boolean; password:string };
const KEY="stockdone.users";
const DEFAULT:User[]=[];
const SESSION="stockdone.session";
export const authStorage={
 getUsers:():User[]=>{try{return JSON.parse(localStorage.getItem(KEY)||"null")||DEFAULT}catch{return DEFAULT}},
 saveUsers:(v:User[])=>localStorage.setItem(KEY,JSON.stringify(v)),
 login:(username:string,password:string)=>authStorage.getUsers().find(u=>u.active&&u.username===username&&u.password===password)||null,
 changePassword:(id:string,current:string,next:string)=>{const users=authStorage.getUsers(),i=users.findIndex(u=>u.id===id);if(i<0||users[i].password!==current||next.length<8)return false;users[i]={...users[i],password:next};authStorage.saveUsers(users);return true},
 setSession:(u:User)=>sessionStorage.setItem(SESSION,JSON.stringify({id:u.id,username:u.username,name:u.name,role:u.role,active:u.active})),
 getSession:():User|null=>{try{const s=sessionStorage.getItem(SESSION);return s?JSON.parse(s):null}catch{return null}},
 clearSession:()=>sessionStorage.removeItem(SESSION),
 can:(role:Role,permission:string)=>{const all:Record<Role,string[]>={owner:["*"],manager:["sales","products","inventory","purchases","customers","returns","reports"],cashier:["sales","customers","print"]};return all[role].includes("*")||all[role].includes(permission)}
};
