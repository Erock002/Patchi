/**
 * Instant Song Search & Spotify Link Resolver.
 * Features:
 *  1. Resolves Spotify Track URLs (e.g. https://open.spotify.com/track/...) via open oEmbed API (no key needed)
 *  2. Searches songs via iTunes Search API with 600x600 high-res album art (no key needed)
 *  3. Curated Quick Test Tracks for 1-tap testing
 */

export interface SearchSongResult {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
}

export const POPULAR_QUICK_SONGS: SearchSongResult[] = [
  {
    title: 'The Rebel Path',
    artist: 'P.T. Adamczyk',
    album: 'Cyberpunk 2077 OST',
    artworkUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&h=600&q=80',
  },
  {
    title: 'Around the World',
    artist: 'Daft Punk',
    album: 'Homework',
    artworkUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&h=600&q=80',
  },
  {
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    artworkUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=600&h=600&q=80',
  },
  {
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    artworkUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&h=600&q=80',
  },
];

/**
 * Check if string is a Spotify URL
 */
export function isSpotifyUrl(query: string): boolean {
  return /open\.spotify\.com\/(track|album|playlist)\/[a-zA-Z0-9]+/.test(query.trim());
}

/**
 * Resolve Spotify Track via oEmbed
 */
export async function resolveSpotifyUrl(url: string): Promise<SearchSongResult | null> {
  try {
    const cleanUrl = url.trim();
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
    const res = await fetch(endpoint);
    if (!res.ok) return null;

    const data = await res.json();
    // Spotify oEmbed returns title formatted like "Track Name" or "Track Name by Artist"
    const rawTitle = data.title || 'Spotify Track';
    let title = rawTitle;
    let artist = 'Spotify';

    if (rawTitle.includes(' by ')) {
      const parts = rawTitle.split(' by ');
      title = parts[0].trim();
      artist = parts.slice(1).join(' by ').trim();
    }

    const artworkUrl = data.thumbnail_url || '';

    // If we have title and artist, do a quick query to iTunes to see if we can get 600x600 artwork and album name
    if (title && artist) {
      const itunesMatches = await searchSongOnline(`${title} ${artist}`);
      if (itunesMatches.length > 0) {
        return itunesMatches[0];
      }
    }

    return {
      title,
      artist,
      album: 'Spotify',
      artworkUrl,
    };
  } catch (err) {
    console.warn('Spotify oEmbed resolution error:', err);
    return null;
  }
}

function cleanQueryString(q: string): string {
  return q
    .replace(/\s*\(.*?feat.*?\)/gi, '')
    .replace(/\s*\[.*?feat.*?\]/gi, '')
    .replace(/\s*\(.*?remaster.*?\)/gi, '')
    .replace(/\s*\[.*?remaster.*?\]/gi, '')
    .replace(/\s*\(.*?version.*?\)/gi, '')
    .replace(/\s*\[.*?version.*?\]/gi, '')
    .replace(/\s*\(.*?deluxe.*?\)/gi, '')
    .replace(/\s*\[.*?deluxe.*?\]/gi, '')
    .replace(/\s*\(.*?anniversary.*?\)/gi, '')
    .replace(/\s*\[.*?anniversary.*?\]/gi, '')
    .replace(/\s*\(.*?mono.*?\)/gi, '')
    .replace(/\s*\(.*?stereo.*?\)/gi, '')
    .replace(/\s*-\s*remastered.*/gi, '')
    .replace(/\s*-\s*live.*/gi, '')
    .replace(/\s*ft\..*/gi, '')
    .replace(/\s*feat\..*/gi, '')
    .trim();
}

/**
 * Searches iTunes Search API for songs and returns results with 600x600 artwork
 */
export async function searchSongOnline(query: string): Promise<SearchSongResult[]> {
  if (!query || query.trim().length < 2) return [];

  // If user pasted a Spotify link, resolve directly
  if (isSpotifyUrl(query)) {
    const spotifyRes = await resolveSpotifyUrl(query);
    if (spotifyRes) return [spotifyRes];
  }

  const performSearch = async (term: string): Promise<SearchSongResult[]> => {
    try {
      const encoded = encodeURIComponent(term.trim());
      const res = await fetch(`https://itunes.apple.com/search?term=${encoded}&entity=song&limit=6`);
      if (!res.ok) return [];

      const data = await res.json();
      if (!data.results || data.results.length === 0) return [];

      return data.results.map((item: any) => {
        const rawArt = item.artworkUrl100 || '';
        const highResArt = rawArt.replace('100x100bb.jpg', '600x600bb.jpg');

        return {
          title: item.trackName || '',
          artist: item.artistName || '',
          album: item.collectionName || '',
          artworkUrl: highResArt || rawArt,
        };
      });
    } catch (err) {
      console.warn('Song search fetch error:', err);
      return [];
    }
  };

  const initialMatches = await performSearch(query);
  if (initialMatches.length > 0) return initialMatches;

  const cleaned = cleanQueryString(query);
  if (cleaned && cleaned !== query.trim()) {
    return await performSearch(cleaned);
  }

  return [];
}
