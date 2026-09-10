import { FACEBOOK, WHATSAPP, SPECTRA_SITE } from '@/lib/site-content';

export default function SiteFooter() {
  return <footer className="spectra-footer" id="footer">
    <div className="footer-stage">
      <div className="footer-orbit" aria-hidden="true">
        <svg viewBox="0 0 1000 1000" focusable="false">
          <defs><path id="spectra-orbit" d="M 90,500 a 410,410 0 1,1 820,0 a 410,410 0 1,1 -820,0"/></defs>
          <text><textPath href="#spectra-orbit" textLength="2530" lengthAdjust="spacing">LET’S MAKE SOMETHING <tspan>SPECTACULAR ✦ </tspan></textPath></text>
        </svg>
      </div>
      <div className="footer-stage-copy" data-reveal="up">
        <p className="eyebrow">Your vision. Our next stage.</p>
        <h2>Tell us the night you have in mind.<br/><em>We’ll bring the house.</em></h2>
        <a className="button" href="/#contact">Get in touch <span className="footer-cta-dot" aria-hidden="true">•</span></a>
      </div>
    </div>
    <div className="footer-directory">
      <div className="footer-address">
        <a className="brand" href="/#top" aria-label="Spectra home"><img src="/assets/reference/logo-mark.png" alt=""/>SPECTRA</a>
        <p className="eyebrow">Find the house</p>
        <p>Bora Cafe & Restaurant<br/>Jeddah, Kingdom of Saudi Arabia</p>
        <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">050 863 4546 ↗</a>
        <a className="footer-social" href={FACEBOOK} target="_blank" rel="noopener noreferrer">Facebook <span aria-hidden="true">↗</span></a>
      </div>
      <nav aria-label="Explore Spectra" className="footer-nav">
        <p className="eyebrow">Explore</p>
        <a href="/#top">Home</a><a href="/#about">The house</a><a href="/#talents">Our talents</a><a href="/#news">News & updates</a><a href="/#contact">Get in touch ↗</a>
      </nav>
      <nav aria-label="Experience Spectra" className="footer-nav">
        <p className="eyebrow">Take the stage</p>
        <a href="/#services">Events & production</a><a href="/contest">Singing Idol</a><a href="/tickets">Get tickets ↗</a><a href={`${SPECTRA_SITE}/audition`}>Auditions ↗</a><a href="/login">Staff sign in</a>
      </nav>
    </div>
    <div className="footer-colophon" data-reveal="up"><span>© {new Date().getFullYear()} Spectra Performing Arts & Production.</span><span>Dream it. Believe it. Perform it.</span><a href="#top">Back to top ↑</a></div>
    <a className="footer-wordmark" href="/" aria-label="Spectra home" data-word="SPECTRA" data-reveal="wordmark"><span aria-hidden="true">SPECTRA</span></a>
  </footer>;
}
