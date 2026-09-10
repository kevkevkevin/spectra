'use client';
import {useState, type FormEvent} from 'react';
import type {ContentItem} from '@/lib/content';
import {defaultTalents, defaultServices, defaultNews, WHATSAPP, SPECTRA_SITE} from '@/lib/site-content';
import {TalentCards,ServiceCards,NewsCards} from './content-sections';
import SiteFooter from './site-footer';

const sections = ['About', 'Talents', 'Services', 'News', 'Contact'];

export default function Landing({content,signedIn}:{content:ContentItem[];signedIn:boolean}) {
  const [menuOpen,setMenuOpen] = useState(false);
  const talents = content.filter(item=>item.kind==='talent');
  const services = content.filter(item=>item.kind==='service');
  const news = content.filter(item=>item.kind==='news');
  function openEnquiry(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const message = `Hello Spectra!\n\nName: ${data.get('name')}\nPhone or email: ${data.get('contact')}\nI am writing about: ${data.get('subject')}\n\n${data.get('message')}`;
    window.open(`${WHATSAPP}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="header">
      <a className="brand" href="#top" aria-label="Spectra home"><img src="/assets/reference/logo-mark.png" alt=""/><span>SPECTRA</span></a>
      <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="navigation" onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen ? 'Close ×' : 'Menu ☰'}</button>
      <nav id="navigation" className={menuOpen ? 'open' : ''} aria-label="Main navigation" onClick={()=>setMenuOpen(false)} onKeyDown={event=>{if(event.key==='Escape')setMenuOpen(false);}}>
        {sections.map(section=><a key={section} href={`#${section.toLowerCase()}`}>{section}</a>)}
        <a href="/contest">Contest</a><a href="/tickets">Tickets</a><a className="button nav-signin" href={signedIn?'/account':'/login'}>{signedIn?'My Account':'Sign in / Sign up'}</a>
      </nav>
    </header>
    <main id="main">
      <section className="hero" id="top" aria-labelledby="hero-title">
        <img className="hero-backdrop" src="/assets/reference/hero.jpg" alt="" fetchPriority="high"/>
        <div className="hero-content" data-reveal="hero">
          <img className="hero-logo" src="/assets/reference/logo.webp" alt="Spectra’s gold emblem surrounded by performers in purple and cyan light" fetchPriority="high"/>
          <h1 id="hero-title" className="sr-only">Spectra Performing Arts and Production</h1>
          <div className="hero-copy"><p>A Spectrum of Extraordinary Talent</p><div className="button-row"><a className="button" href="#about">Explore more <span aria-hidden="true">↗</span></a><a className="text-link" href="#talents">Check the talents <span aria-hidden="true">↓</span></a></div></div>
        </div>
      </section>
      <section className="about section" id="about">
        <div data-reveal="left"><p className="eyebrow">The house</p><h2>Nights designed to <br/>be remembered.</h2></div>
        <div className="about-copy" data-reveal="right"><p>We build evenings that audiences feel, not just attend. Spectra discovers, refines, and presents extraordinary talent — then produces the rooms they shine in. From Thursday live at Bora Cafe to consular nights and full-scale entertainment.</p><p className="house-motto">One voice. One dream. One star.</p></div>
      </section>
      <section className="talents section" id="talents">
        <div className="section-head" data-reveal="up"><div><p className="eyebrow">The roster</p><h2>Talents</h2></div><p>Meet the house — voices, presence, and the director who leads the stage.</p></div>
        <TalentCards items={talents.length ? talents : defaultTalents}/>
        <div className="roster-note"><span className="spark" aria-hidden="true">✦</span><p><strong>Newest voice of the house: James Armenta.</strong> A new voice. A new journey. A new chapter begins. From Camp Ensemble to the Spectra stage — welcome to the family.</p></div>
      </section>
      <section className="contest section" aria-labelledby="contest-title">
        <div className="contest-copy" data-reveal="left"><p className="eyebrow">Spectra’s Next Singing Idol</p><h2 id="contest-title">TOP 21<br/><em>Official Contenders</em></h2><p className="contest-tagline">One stage. One voice. One star.</p><p>The Top 21 official contenders take the Bora stage. Two elimination nights. One house vote. One star.</p><div className="event-details"><span>Bora Cafe & Restaurant</span><strong>September 18 & 25, 2026</strong><span>3PM · Jeddah</span></div><div className="button-row"><a className="button" href="/contest">Vote the Top 21 <span aria-hidden="true">↗</span></a><a className="button button-outline" href="/tickets">Get tickets <span aria-hidden="true">↗</span></a></div></div>
        <a className="contest-poster" href="/contest" data-reveal="right"><img src="/assets/reference/contest-top21.jpg" alt="Spectra’s Next Singing Idol — Top 21 official contenders at Bora Cafe" loading="lazy"/></a>
      </section>
      <section className="services section" id="services"><div className="section-head" data-reveal="up"><div><p className="eyebrow">What we create</p><h2>Services</h2></div><p>From the first idea to the final ovation.<br/>Let’s make your night a Spectra night.</p></div><ServiceCards items={services.length ? services : defaultServices}/></section>
      <section className="news section" id="news"><div className="section-head" data-reveal="up"><div><p className="eyebrow">Insights</p><h2>News & updates</h2></div><p>Auditions, nights, and new voices —<br/>from the Spectra family.</p></div><NewsCards items={news.length ? news : defaultNews}/></section>
      <section className="contact section" id="contact">
        <div className="contact-copy" data-reveal="left"><p className="eyebrow">Your stage is waiting</p><h2>Book the night.</h2><p>Private nights, galas, residencies, and Spectra’s Next Singing Idol. Write to us — or send an audition if you are ready for the spotlight.</p><dl><div><dt>WhatsApp</dt><dd><a href={WHATSAPP} target="_blank" rel="noopener noreferrer">050 863 4546 ↗</a></dd></div><div><dt>Home stage</dt><dd>Bora Cafe & Restaurant<br/>Jeddah, Kingdom of Saudi Arabia</dd></div><div><dt>Tickets</dt><dd><a href="/tickets">Find your next night ↗</a></dd></div><div><dt>Auditions</dt><dd><a href={`${SPECTRA_SITE}/audition`}>Spectra’s Next Singing Idol ↗</a></dd></div></dl></div>
        <form className="contact-form" data-reveal="right" onSubmit={openEnquiry}><div className="form-row"><label>Name<input name="name" autoComplete="name" required maxLength={120}/></label><label>Phone or email<input name="contact" required maxLength={254}/></label></div><label>I am writing about<select name="subject"><option>Book a talent</option><option>Events & production</option><option>Entertainment night</option><option>Audition for Spectra</option></select></label><label>Message<textarea name="message" rows={5} required maxLength={3000}/></label><button className="button" type="submit">Send on WhatsApp <span aria-hidden="true">↗</span></button><p className="form-hint">Opens WhatsApp with your enquiry ready to review and send.</p></form>
      </section>
    </main>
    <SiteFooter/>
  </>;
}
