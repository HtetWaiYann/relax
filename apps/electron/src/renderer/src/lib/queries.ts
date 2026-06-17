import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MediaType,
  SortOrder,
  WatchlistFilter,
  WatchlistSort,
  type WatchProgress,
  type WatchlistItem,
} from '@relax/types';
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

const HISTORY_KEY = ['watch-history'] as const;

export function useWatchHistory(limit = 20) {
  return useQuery({
    queryKey: [...HISTORY_KEY, limit],
    queryFn: () => relaxClient.getWatchHistory({ limit, offset: 0 }),
    staleTime: 30_000,
  });
}

export function useDeleteWatchProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Pick<WatchProgress, 'mediaId' | 'mediaType' | 'season' | 'episode'>) =>
      relaxClient.deleteWatchProgress({
        mediaId: p.mediaId,
        mediaType: p.mediaType,
        season: p.season,
        episode: p.episode,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HISTORY_KEY }),
  });
}

export function useClearWatchHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => relaxClient.clearWatchHistory({}),
    onSuccess: () => qc.invalidateQueries({ queryKey: HISTORY_KEY }),
  });
}

const WATCHLIST_KEY = ['watchlist'] as const;
const WATCHLIST_STATUS_PREFIX = 'watchlist-status';

export type WatchlistSortKey = 'added_at' | 'title_asc' | 'title_desc' | 'rating';

function sortToProto(s: WatchlistSortKey): { sortBy: WatchlistSort; order: SortOrder } {
  switch (s) {
    case 'title_asc':
      return { sortBy: WatchlistSort.TITLE, order: SortOrder.ASC };
    case 'title_desc':
      return { sortBy: WatchlistSort.TITLE, order: SortOrder.DESC };
    case 'rating':
      return { sortBy: WatchlistSort.RATING, order: SortOrder.DESC };
    case 'added_at':
    default:
      return { sortBy: WatchlistSort.ADDED_AT, order: SortOrder.DESC };
  }
}

function filterToProto(f: 'all' | 'movie' | 'tv'): WatchlistFilter {
  if (f === 'movie') return WatchlistFilter.MOVIE;
  if (f === 'tv') return WatchlistFilter.TV;
  return WatchlistFilter.ALL;
}

const WATCHLIST_PAGE_SIZE = 30;

export function useInfiniteWatchlist(
  sort: WatchlistSortKey,
  filter: 'all' | 'movie' | 'tv',
) {
  const { sortBy, order } = sortToProto(sort);
  const mediaTypeFilter = filterToProto(filter);
  return useInfiniteQuery({
    queryKey: [...WATCHLIST_KEY, sort, filter],
    queryFn: ({ pageParam }) =>
      relaxClient.getWatchlist({
        sortBy,
        order,
        mediaTypeFilter,
        limit: WATCHLIST_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      return loaded < lastPage.totalCount ? loaded : undefined;
    },
    staleTime: 30_000,
  });
}

export function useIsInWatchlist(mediaId: string, mediaType: MediaType) {
  return useQuery({
    queryKey: [WATCHLIST_STATUS_PREFIX, mediaId, mediaType],
    queryFn: () => relaxClient.isInWatchlist({ mediaId, mediaType }),
    enabled: mediaId !== '' && mediaType !== MediaType.UNSPECIFIED,
    staleTime: 60_000,
  });
}

export type WatchlistInput = Omit<WatchlistItem, '$typeName' | 'addedAt'>;

function statusKey(mediaId: string, mediaType: MediaType) {
  return [WATCHLIST_STATUS_PREFIX, mediaId, mediaType] as const;
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: WatchlistInput) =>
      relaxClient.addToWatchlist({ item: item as unknown as WatchlistItem }),
    onMutate: async (item) => {
      const key = statusKey(item.mediaId, item.mediaType);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, { inWatchlist: true });
      return { prev, key };
    },
    onError: (_e, _item, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { mediaId: string; mediaType: MediaType }) =>
      relaxClient.removeFromWatchlist({ mediaId: p.mediaId, mediaType: p.mediaType }),
    onMutate: async (p) => {
      const key = statusKey(p.mediaId, p.mediaType);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, { inWatchlist: false });
      return { prev, key };
    },
    onError: (_e, _p, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });
}

export function useClearWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => relaxClient.clearWatchlist({}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WATCHLIST_KEY });
      qc.invalidateQueries({ queryKey: [WATCHLIST_STATUS_PREFIX] });
    },
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
