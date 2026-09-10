'use client';
import {useEffect,useTransition} from 'react';
import {useRouter} from 'next/navigation';
export default function OrderRefresh({poll=true}:{poll?:boolean}) {
 const router=useRouter();const [pending,startTransition]=useTransition();
 useEffect(()=>{if(!poll)return;const refresh=()=>{if(document.visibilityState==='visible')router.refresh();};const timer=setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[router,poll]);
 return <button className="text-button" disabled={pending} onClick={()=>startTransition(()=>router.refresh())}>{pending?'Refreshing…':'Refresh status ↻'}</button>;
}
