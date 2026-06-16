import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { MediaType } from '@relax/types';
import { relaxClient } from './client';

const HOME_KEY = ['home'] as const;
const DETAIL_PREFIX = 'detail';
const SEARCH_PREFIX = 'search';
const BROWSE_PREFIX = 'browse';
const PERSON_PREFIX = 'person';
const STREAMS_PREFIX = 'streams';

export function useHomeSections() {
  return useQuery({
    queryKey: HOME_KEY,
    queryFn: () => relaxClient.getHomeSections({}),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

// TMDB caps both /discover and /search pagination at 500 pages.
const TMDB_PAGE_CAP = 500;

function nextPage(lastPage: { page: number; totalPages: number }): number | undefined {
  const next = (lastPage.page || 1) + 1;
  const cap = Math.min(lastPage.totalPages, TMDB_PAGE_CAP);
  return next <= cap ? next : undefined;
}

export function useInfiniteSearchMedia(query: string) {
  return useInfiniteQuery({
    queryKey: [SEARCH_PREFIX, query],
    queryFn: ({ pageParam }) => relaxClient.searchMedia({ query, page: pageParam }),
    enabled: query.trim().length > 0,
    initialPageParam: 1,
    getNextPageParam: nextPage,
    staleTime: 30_000,
  });
}

export function useMediaDetail(mediaType: MediaType, tmdbId: number) {
  return useQuery({
    queryKey: [DETAIL_PREFIX, mediaType, tmdbId],
    queryFn: () => relaxClient.getMediaDetail({ mediaType, tmdbId }),
    enabled: tmdbId > 0 && mediaType !== MediaType.UNSPECIFIED,
    staleTime: 5 * 60_000,
  });
}

export type BrowseKind = 'movies' | 'series' | 'anime';

export function useInfiniteBrowseMedia(kind: BrowseKind) {
  const mediaType = kind === 'movies' ? MediaType.MOVIE : MediaType.TV;
  const anime = kind === 'anime';
  return useInfiniteQuery({
    queryKey: [BROWSE_PREFIX, kind],
    queryFn: ({ pageParam }) => relaxClient.browseMedia({ mediaType, anime, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    staleTime: 5 * 60_000,
  });
}

export function useStreams(
  mediaType: MediaType,
  tmdbId: number,
  season?: number,
  episode?: number,
) {
  const isTV = mediaType === MediaType.TV;
  const ready =
    tmdbId > 0 &&
    mediaType !== MediaType.UNSPECIFIED &&
    (!isTV || ((season ?? 0) > 0 && (episode ?? 0) > 0));
  return useQuery({
    queryKey: [STREAMS_PREFIX, mediaType, tmdbId, season ?? 0, episode ?? 0],
    queryFn: () =>
      relaxClient.getStreams({
        tmdbId,
        mediaType,
        season: isTV ? (season ?? 0) : 0,
        episode: isTV ? (episode ?? 0) : 0,
      }),
    enabled: ready,
    staleTime: 60_000,
  });
}

export function usePersonDetail(personId: number) {
  return useQuery({
    queryKey: [PERSON_PREFIX, personId],
    queryFn: () => relaxClient.getPersonDetail({ personId }),
    enabled: personId > 0,
    staleTime: 10 * 60_000,
  });
}

export function mediaTypeFromRoute(value: string | undefined): MediaType {
  if (value === 'movie') return MediaType.MOVIE;
  if (value === 'tv') return MediaType.TV;
  return MediaType.UNSPECIFIED;
}

export function mediaTypeToRoute(mt: MediaType): 'movie' | 'tv' {
  return mt === MediaType.TV ? 'tv' : 'movie';
}
