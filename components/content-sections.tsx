import { FACEBOOK, type SiteItem } from '@/lib/site-content';

export function TalentCards({items}:{items:SiteItem[]}) {
  return <div className="talent-grid">{items.map(item => <article className="talent-card" key={item.id}>
    {item.image_url && <img src={item.image_url} alt={item.title} loading="lazy"/>}
    <div className="talent-info"><p className="eyebrow">{item.label || 'Spectra artist'}</p><h3>{item.title}</h3>
      <div className="talent-bio"><p>{item.description}</p><a href={FACEBOOK} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} on Facebook`}>Meet the artist <span aria-hidden="true">↗</span></a></div>
    </div>
  </article>)}</div>;
}

export function ServiceCards({items}:{items:SiteItem[]}) {
  return <div className="service-grid">{items.map((item,i) => <article className="service-card" key={item.id}>
    <div className="service-image" data-reveal={i%2 ? 'right' : 'left'}>{item.image_url && <img src={item.image_url} alt="" loading="lazy"/>}</div>
    <div className="service-copy" data-reveal={i%2 ? 'left' : 'right'} data-reveal-delay="70"><p className="service-number">{String(i+1).padStart(2,'0')}</p><h3>{item.title}</h3><p>{item.description}</p><a className="text-link" href="#contact">Book this <span aria-hidden="true">↗</span></a></div>
  </article>)}</div>;
}

export function NewsCards({items}:{items:SiteItem[]}) {
  return <div className="news-items">{items.map(item => <article className="news-card" key={item.id}>
    <div className="news-image">{item.image_url && <img loading="lazy" src={item.image_url} alt={item.title}/>}</div>
    <div className="news-copy"><p className="eyebrow">{item.label || 'News & updates'}</p><h3>{item.title}</h3><p>{item.description}</p>
      {item.href && <a className="text-link" href={item.href}>Explore the story <span aria-hidden="true">↗</span></a>}
    </div>
  </article>)}</div>;
}
