import { MediaType, type MediaDetail } from '@relax/types';

export interface ExternalLinks {
  imdbUrl: string | null;
  letterboxdUrl: string | null;
}

// Build outbound links for a title. IMDb needs the imdb_id (can be missing,
// especially for TV); Letterboxd redirects by TMDB id but only supports movies.
export function getExternalLinks(detail: MediaDetail, mediaType: MediaType): ExternalLinks {
  const imdbId = detail.imdbId?.trim();
  const tmdbId = detail.summary?.tmdbId ?? 0;
  return {
    imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
    letterboxdUrl:
      mediaType === MediaType.MOVIE && tmdbId > 0
        ? `https://letterboxd.com/tmdb/${tmdbId}/`
        : null,
  };
}
