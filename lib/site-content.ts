import type { ContentItem } from './content';

export const SPECTRA_SITE = 'https://spectraproduction.grok.me';
export const FACEBOOK = 'https://www.facebook.com/profile.php?id=61591195421701';
export const WHATSAPP = 'https://wa.me/966508634546';
export type SiteItem = ContentItem & { label?: string; href?: string };
const item = (id: string, kind: ContentItem['kind'], title: string, description: string, image: string, label?: string, href?: string): SiteItem => ({id, kind, title, description, image_url: `/assets/reference/${image}`, published: true, position: 0, label, href});

// Reference content captured from the Spectra website on 7 September 2026.
// Published Supabase entries override these defaults for their category.
export const defaultTalents: SiteItem[] = [
  item('lei', 'talent', 'Lei', 'Director and artist of the house. Lei shapes the nights, the roster, and the Spectra stage — vision, direction, and performance in one.', 'lei-portrait.jpg', 'Director / Artist'),
  item('yzzai', 'talent', 'Yzzai Racho', 'Princess of All Titles and the Golden Voice of Spectra. A true total performer whose stage presence, humility, and two International Golden Awards have made her the Superdiva of the house.', 'golden-voice.jpg', 'The Golden Voice'),
  item('yhong', 'talent', 'Yhong Balneg', 'A complete artist of voice and presence. Yhong’s rendition of “Ngiti” for Spectra’s OPM Collection at the Philippine Consulate General in Jeddah captured the house at its most heartfelt.', 'total-performer.jpg', 'The Total Performer'),
  item('superstar', 'talent', 'Featured Vocalist', 'The Superstar of the Spectra roster — a commanding live vocalist whose sequined nights and spotlight presence define the house’s glamour.', 'superstar.jpg', 'The Superstar'),
  item('bon', 'talent', 'Bon', 'A voice that delivers every emotion, on and off the stage. Beyond the ballads, Bon helps bring every Spectra production to life as Event & Entertainment Assistant Director.', 'fearless-balladeer.jpg', 'The Fearless Balladeer'),
  item('mj', 'talent', 'MJ', 'Vocals as pure and captivating as crystal. MJ is a fresh face with a bright future — grace, passion, and a voice that leaves the room wanting one more note.', 'crystal-voice.jpg', 'The Crystal Voice'),
  item('cloie', 'talent', 'Cloie', 'A young star with a powerful voice and undeniable stage presence. Cloie reminds the house that extraordinary talent knows no age.', 'little-diva.jpg', 'The Little Diva'),
];
export const defaultServices: SiteItem[] = [
  item('talents', 'service', 'Talents', 'Singers, dancers, actors, and specialty performers for residencies, galas, brand stages, and private nights.', 'service-talents.jpg'),
  item('events', 'service', 'Events', 'Cultural evenings, consular programs, brand experiences, and Thursday live at Bora Cafe.', 'service-events.jpg'),
  item('production', 'service', 'Production', 'End-to-end showmaking: direction, staging, talent direction, and run-of-show — from lounges to halls.', 'about.jpg'),
  item('entertainment', 'service', 'Entertainment', 'Live music, cultural programs, fashion collaborations, and house nights with polish.', 'service-entertainment.jpg'),
];
export const defaultNews: SiteItem[] = [
  item('top21', 'news', 'Top 21 Official Contenders', 'Spectra’s Next Singing Idol elimination rounds — September 18 and 25, 3PM at Bora Cafe. Vote the Top 21.', 'contest-top21.jpg', 'Elimination · 18–25 September 2026', '/contest'),
  item('opm', 'news', 'OPM Collection at the Consulate', 'Yhong Balneg brought “Ngiti” to Spectra’s OPM Collection at the Philippine Consulate General in Jeddah.', 'news-opm.jpg', 'On stage · 30 July 2026', '#talents'),
];
