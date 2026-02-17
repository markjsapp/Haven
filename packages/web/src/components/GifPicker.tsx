import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth.js";
import type { GifResult } from "@haven/core";

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

// ─── Module-level cache (persists across opens) ─────────
const cache = {
  trending: null as GifResult[] | null,
  trendingFetchedAt: 0,
  searches: new Map<string, { results: GifResult[]; fetchedAt: number }>(),
};

const TRENDING_TTL = 5 * 60 * 1000; // 5 minutes
const SEARCH_TTL = 2 * 60 * 1000;   // 2 minutes
const DEBOUNCE_MS = 500;

export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"trending" | "search">("trending");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against React Strict Mode double-firing
  const fetchedRef = useRef(false);

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Load trending on mount (once)
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadTrending();
  }, []);

  const loadTrending = useCallback(async () => {
    // Use cache if fresh
    const now = Date.now();
    if (cache.trending && now - cache.trendingFetchedAt < TRENDING_TTL) {
      setResults(cache.trending);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { api } = useAuthStore.getState();
      const resp = await api.trendingGifs();
      cache.trending = resp.results;
      cache.trendingFetchedAt = Date.now();
      setResults(resp.results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Failed to load trending GIFs:", msg);
      setError(msg);
      // Show stale cache if available
      if (cache.trending) {
        setResults(cache.trending);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const searchGifs = useCallback(async (q: string) => {
    if (!q.trim()) {
      setMode("trending");
      loadTrending();
      return;
    }

    const key = q.trim().toLowerCase();

    // Use cache if fresh
    const now = Date.now();
    const cached = cache.searches.get(key);
    if (cached && now - cached.fetchedAt < SEARCH_TTL) {
      setMode("search");
      setResults(cached.results);
      setError(null);
      return;
    }

    setLoading(true);
    setMode("search");
    setError(null);
    try {
      const { api } = useAuthStore.getState();
      const resp = await api.searchGifs(q.trim());
      cache.searches.set(key, { results: resp.results, fetchedAt: Date.now() });
      // Evict old entries if cache grows too large
      if (cache.searches.size > 50) {
        const oldest = [...cache.searches.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
        if (oldest) cache.searches.delete(oldest[0]);
      }
      setResults(resp.results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("GIF search failed:", msg);
      setError(msg);
      // Show stale cache if available
      if (cached) {
        setResults(cached.results);
      }
    } finally {
      setLoading(false);
    }
  }, [loadTrending]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchGifs(value);
    }, DEBOUNCE_MS);
  }

  function handleBack() {
    setQuery("");
    setMode("trending");
    loadTrending();
    searchInputRef.current?.focus();
  }

  function handleGifClick(gif: GifResult) {
    onSelect(gif.url);
    onClose();
  }

  return (
    <div className="gif-picker" ref={ref} role="dialog" aria-label={t("gifPicker.ariaLabel")}>
      <div className="gif-picker-inner">
        {/* Search bar */}
        <div className="gif-search-bar">
          {mode === "search" && (
            <button type="button" className="gif-back-btn" onClick={handleBack} aria-label={t("gifPicker.backAriaLabel")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
          )}
          <div className="gif-search-input-wrap">
            <svg className="gif-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className="gif-search-field"
              placeholder={t("gifPicker.searchPlaceholder")}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              autoFocus
            />
            {query && (
              <button type="button" className="gif-clear-btn" onClick={() => { setQuery(""); handleBack(); }} aria-label={t("gifPicker.clearSearchAriaLabel")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Header */}
        <div className="gif-section-header">
          {mode === "trending" ? t("gifPicker.trending") : t("gifPicker.resultsFor", { query })}
        </div>

        {/* Grid */}
        <div className="gif-grid-container">
          {loading && results.length === 0 && (
            <div className="gif-loading">{t("gifPicker.loading")}</div>
          )}
          {!loading && error && results.length === 0 && (
            <div className="gif-empty gif-error">
              <div>{t("gifPicker.failedToLoad")}</div>
              <div className="gif-error-detail">{error}</div>
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="gif-empty">
              {mode === "search" ? t("gifPicker.noGifsFound") : t("gifPicker.noTrending")}
            </div>
          )}
          <div className="gif-grid">
            {results.map((gif) => (
              <GifGridItem key={gif.id} gif={gif} onClick={handleGifClick} />
            ))}
          </div>
        </div>

        {/* Giphy attribution (required by ToS) */}
        <div className="gif-attribution">
          {t("gifPicker.poweredByGiphy")}
        </div>
      </div>
    </div>
  );
}

function GifGridItem({ gif, onClick }: { gif: GifResult; onClick: (gif: GifResult) => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="gif-grid-item"
      onClick={() => onClick(gif)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ aspectRatio: `${gif.width} / ${gif.height}` }}
    >
      <img
        src={hovered ? gif.url : gif.preview_url}
        alt={gif.title}
        loading="lazy"
      />
    </div>
  );
}
