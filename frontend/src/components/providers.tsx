'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
const ToastContext=createContext<(message:string,error?:boolean)=>void>(()=>{});
export const useToast=()=>useContext(ToastContext);
export function Providers({children}:{children:React.ReactNode}){
  const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:1,staleTime:30000,refetchOnWindowFocus:true}}}));
  const [toast,setToast]=useState<{message:string;error:boolean}|null>(null);
  const notify=useCallback((message:string,error=false)=>{setToast({message,error});},[]);
  return <QueryClientProvider client={client}><ToastContext.Provider value={notify}>{children}{toast&&<div className={`toast ${toast.error?'error':''}`} role={toast.error?'alert':'status'}>{toast.error?<AlertCircle size={20}/>:<CheckCircle2 size={20}/>}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={18}/></button></div>}</ToastContext.Provider></QueryClientProvider>;
}
