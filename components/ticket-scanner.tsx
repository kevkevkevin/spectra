'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import jsQR from 'jsqr';
import {scanTicket} from '@/app/staff/scan/actions';
import {ticketToken,type ScanEvent,type ScanMode,type ScanResponse} from '@/lib/scanner';
import {eventDate} from '@/lib/tickets';

export default function TicketScanner({events,initialToken}:{events:ScanEvent[];initialToken?:string}) {
 const [eventId,setEventId]=useState('');
 const [mode,setMode]=useState<ScanMode>('entry');
 const [code,setCode]=useState(initialToken??'');
 const [camera,setCamera]=useState(false);
 const [starting,setStarting]=useState(false);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [result,setResult]=useState<(ScanResponse&{mode:ScanMode})|null>(null);
 const video=useRef<HTMLVideoElement>(null);
 const stream=useRef<MediaStream|null>(null);
 const busy=useRef(false);
 const lastDecoded=useRef<string|null>(null);
 const generation=useRef(0);
 const dialog=useRef<HTMLDialogElement>(null);
 const event=events.find(item=>item.id===eventId);
 useEffect(()=>{
  try{
   const saved=JSON.parse(sessionStorage.getItem('spectra-counter')??'null');
   if(events.some(item=>item.id===saved?.eventId))setEventId(saved.eventId);
   if(saved?.mode==='entry'||saved?.mode==='food')setMode(saved.mode);
  }catch{ /* Session preferences are optional. */ }
 },[events]);
 useEffect(()=>{try{if(eventId)sessionStorage.setItem('spectra-counter',JSON.stringify({eventId,mode}));}catch{}},[eventId,mode]);
 const stopCamera=useCallback(()=>{
  generation.current++;
  stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
  lastDecoded.current=null;
  if(video.current)video.current.srcObject=null;
  setCamera(false);setStarting(false);
 },[]);
 useEffect(()=>{
  const onHidden=()=>{if(document.visibilityState==='hidden')stopCamera();};
  document.addEventListener('visibilitychange',onHidden);
  return()=>{generation.current++;stream.current?.getTracks().forEach(track=>track.stop());document.removeEventListener('visibilitychange',onHidden);};
 },[stopCamera]);
 useEffect(()=>{if(result&&!dialog.current?.open)dialog.current?.showModal();},[result]);
 const accept=useCallback(async(raw:string)=>{
  if(busy.current||result)return;
  if(!eventId){setError('Select the event you are working at first.');return;}
  const token=ticketToken(raw);
  if(!token){setError('This QR is not a Spectra ticket. Try the approved ticket in the guest’s account.');return;}
  busy.current=true;setPending(true);setError('');
  try{
   const response=await scanTicket({code:token,mode,eventId});
   setResult({...response,mode});
  }catch{
   setResult({mode,error:'No confirmation received. Check your connection, then scan again. A repeated scan will not record a second entry or meal.'});
  }finally{setPending(false);busy.current=false;}
 },[eventId,mode,result]);
 useEffect(()=>{
  if(!camera||pending||result)return;
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d',{willReadFrequently:true});
  const interval=setInterval(()=>{
   if(!context||!video.current||video.current.readyState<2||busy.current)return;
   const width=video.current.videoWidth,height=video.current.videoHeight;
   if(!width||!height)return;
   const scale=Math.min(1,1000/Math.max(width,height));
   canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
   context.drawImage(video.current,0,0,canvas.width,canvas.height);
   const frame=context.getImageData(0,0,canvas.width,canvas.height);
   const found=jsQR(frame.data,frame.width,frame.height,{inversionAttempts:'dontInvert'});
   if(found){
    const token=ticketToken(found.data);
    if(token&&token!==lastDecoded.current){lastDecoded.current=token;void accept(token);}
   }else lastDecoded.current=null;
  },300);
  return()=>clearInterval(interval);
 },[camera,pending,result,accept]);
 async function startCamera(){
  if(!eventId){setError('Select an event before starting the camera.');return;}
  setError('');setStarting(true);const request=++generation.current;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('secure');
   const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
   if(generation.current!==request){next.getTracks().forEach(track=>track.stop());return;}
   stream.current=next;
   if(video.current){video.current.srcObject=next;await video.current.play();}
   if(generation.current!==request)return;
   setCamera(true);setStarting(false);
  }catch{
   if(generation.current!==request)return;
   stopCamera();setError('Camera unavailable. Allow camera access and use HTTPS (or localhost). You can also upload a QR image or paste its link below.');
  }
 }
 async function readImage(file?:File){
  if(!file)return;
  stopCamera();setError('');
  if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Choose a PNG, JPEG or WebP image up to 10 MB.');return;}
  const request=generation.current;
  const url=URL.createObjectURL(file);
  try{
   const image=new Image();image.src=url;await image.decode();
   // Changing the selected event or counter invalidates an image still decoding.
   if(request!==generation.current)return;
   const scale=Math.min(1,1800/Math.max(image.width,image.height));
   const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
   const context=canvas.getContext('2d');if(!context)throw new Error('image');
   context.drawImage(image,0,0,canvas.width,canvas.height);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height);
   const found=jsQR(pixels.data,pixels.width,pixels.height);
   if(!found){setError('No readable QR found. Try a clear, cropped image of the ticket QR.');return;}
   await accept(found.data);
  }catch{if(request===generation.current)setError('The image could not be read. Try another image or paste the ticket link.');}
  finally{URL.revokeObjectURL(url);}
 }
 const scan=result?.scan;
 const success=scan?.result==='success';
 const label=result?.mode==='food'?'Food redeemed':'Entry confirmed';
 const title=result?.error?'Scan not confirmed':success?label:scan?.result==='already_used'?(result?.mode==='food'?'Food already redeemed':'Already checked in'):scan?.result==='entry_required'?'Entry scan needed':scan?.result==='wrong_event'?'Different event':'Ticket not valid';
 function dismiss(){dialog.current?.close();setResult(null);setCode('');}
 return <div className="scanner-layout"><section className="ticket-panel scanner-controls"><p className="eyebrow">01 / Your counter</p><label>Event<select value={eventId} onChange={e=>{stopCamera();setEventId(e.target.value);setError('');}} disabled={pending||Boolean(result)}><option value="">Choose an event</option>{events.map(item=><option key={item.id} value={item.id}>{item.title} · {eventDate(item.starts_at)}</option>)}</select></label>{!events.length&&<p className="notice">No events available. Ask an admin to create an event.</p>}<fieldset className="scan-mode" disabled={pending||Boolean(result)}><legend>Scan mode</legend>{(['entry','food'] as const).map(value=><label className={mode===value?'selected':''} key={value}><input type="radio" name="scan_mode" value={value} checked={mode===value} onChange={()=>{stopCamera();setMode(value);setError('');}}/><span className="scan-mode-number">{value==='entry'?'01':'02'}</span><span><strong>{value==='entry'?'Event entry':'Food counter'}</strong><small>{value==='entry'?'Welcome your guest':'Redeem one meal'}</small></span></label>)}</fieldset><div className="scanner-counter-note"><span className="status-badge approved">{mode==='entry'?'Entry mode':'Food mode'}</span><h2>{mode==='entry'?'The night starts here.':'A little fuel for the night.'}</h2><p>{mode==='entry'?'A successful scan records one guest’s arrival.':'Use the same QR after event entry. Each ticket includes one food redemption.'}</p><small>Repeated scans show the original status and cannot redeem a second entry or meal.</small></div></section><section className="ticket-panel scanner-camera-panel"><p className="eyebrow">02 / Scan the ticket</p><div className={`camera-viewport ${camera?'camera-active':''}`}><video ref={video} muted playsInline aria-label="QR scanner camera preview"/>{!camera&&<div className="camera-placeholder"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M6 27V6h21M53 6h21v21M74 53v21H53M27 74H6V53M27 27h10v10H27zM47 27h9v10h-9zM27 47h10v9H27zM47 47h9v9h-9z"/></svg><h2>{starting?'Opening camera…':'Ready when you are.'}</h2><p>{event?`${event.title} · ${mode==='entry'?'Entry':'Food'}`:'Choose your event to begin'}</p></div>}{camera&&<span className="camera-frame"/>}{pending&&<div className="camera-processing" role="status">Confirming {mode==='entry'?'entry':'food'}…</div>}</div><div className="scanner-camera-actions">{camera||starting?<button type="button" className="button button-outline" onClick={stopCamera}>Stop camera</button>:<button type="button" className="button" disabled={!eventId||pending||Boolean(result)} onClick={()=>void startCamera()}>Start camera ↗</button>}<span>Keep one QR inside the frame.</span></div>{error&&<p role="alert" className="notice">{error}</p>}<details className="scanner-alternatives"><summary>Upload a QR image or use a ticket link</summary><label>QR image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!eventId||pending||Boolean(result)} onChange={e=>{void readImage(e.target.files?.[0]);e.target.value='';}}/></label></details><form className={`scanner-manual ${initialToken?'ticket-link-ready':''}`} onSubmit={e=>{e.preventDefault();stopCamera();void accept(code);}}><label>{initialToken?'Ticket link ready to scan':'Ticket link or QR token'}<input value={code} onChange={e=>setCode(e.target.value)} maxLength={600} placeholder="Paste the Spectra ticket QR link" autoComplete="off" required disabled={pending}/></label><button className="button button-outline" disabled={!eventId||!code.trim()||pending||Boolean(result)}>{pending?'Confirming…':`Confirm ${mode==='entry'?'entry':'food'}`}</button></form></section><dialog ref={dialog} className={`scan-result-modal ${success?'scan-success':''}`} onCancel={e=>{e.preventDefault();dismiss();}}><p className="eyebrow">{result?.mode==='food'?'Food counter':'Event entry'}</p><span className="scan-result-icon" aria-hidden="true">{success?'✓':'!'}</span><h2>{title}</h2>{result?.error?<p>{result.error}</p>:<>{scan?.guest_name&&<p className="scan-result-guest">{scan.guest_name} · Ticket {scan.seat_number}</p>}{scan?.event_title&&<p>{scan.event_title}</p>}<p>{success?'Saved. The guest’s open ticket screen and the admin ticket status will update shortly.':scan?.result==='already_used'?'This ticket has already been scanned for this counter. Do not redeem it again.':scan?.result==='entry_required'?'Send this guest to the entry counter first, then scan here for food.':scan?.result==='wrong_event'?'Select the event shown on the guest’s ticket and try again.':'This code does not match an approved ticket.'}</p>{(scan?.checked_in_at||scan?.food_redeemed_at)&&<dl className="scan-result-times"><div><dt>Entry</dt><dd>{scan.checked_in_at?eventDate(scan.checked_in_at):'Not scanned'}</dd></div><div><dt>Food</dt><dd>{scan.food_redeemed_at?eventDate(scan.food_redeemed_at):'Not redeemed'}</dd></div></dl>}</>}<button type="button" className="button" autoFocus onClick={dismiss}>Next guest</button></dialog></div>;
}
