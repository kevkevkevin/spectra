'use client';
import {useFormStatus} from 'react-dom';
export default function SubmitButton({children,pending='Saving…',disabled=false}:{children:React.ReactNode;pending?:string;disabled?:boolean}) {
 const {pending:busy}=useFormStatus();
 return <button type="submit" className="button" disabled={disabled||busy}>{busy?pending:children}</button>;
}
