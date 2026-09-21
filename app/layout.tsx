import type { Metadata } from 'next';
import './site.css';
import './globals.css';
import './footer.css';
import './tickets.css';
import './scanner.css';
import './staff-admin.css';
import './scan-status.css';
import './navigation.css';
import './homepage-refresh.css';
import './tabulation.css';
import ScrollMotion from '@/components/scroll-motion';
export const metadata: Metadata = {title:'Spectra — Performing Arts & Production',description:'A spectrum of extraordinary talent. Discover Spectra performing arts, entertainment, events and production.'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet"/></head><body>{children}<ScrollMotion/></body></html>}
