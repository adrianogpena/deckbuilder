import { sourceFetch } from '../../connections/errors';
import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { fields, FX_FIELDS, RSS_SOURCE_FIELDS, WEATHER_SOURCE_FIELDS } from './fields';
import { currencyCode, mapSeries, startDate, type FxData } from './fx';
import { feedUrls, mergeFeeds, parseFeed, type Feed, type FeedItem } from './rss';
import { emptyWeather, forecastParams, mapForecast, placeName, type WeatherData, type WeatherUnits } from './weather';

const MAX_FEED_BYTES = 5_000_000;
const headers = { 'user-agent': 'DeckBuilder', accept: 'application/json' };

interface Place {
  lat: number;
  lon: number;
  name: string;
}
const places = new Map<string, Place>();

async function geocode(location: string, signal: AbortSignal): Promise<Place | undefined> {
  const key = location.trim().toLowerCase();
  const hit = places.get(key);
  if (hit) return hit;
  const res = await sourceFetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.trim())}&count=1`, { headers }, { signal });
  const found = ((await res.json()) as any)?.results?.[0];
  if (typeof found?.latitude !== 'number' || typeof found?.longitude !== 'number') return undefined;
  const place = { lat: found.latitude, lon: found.longitude, name: placeName(found) };
  places.set(key, place);
  return place;
}

export const weatherSource = defineSource<{ location: string; units: WeatherUnits; days: number }>({
  id: 'feeds-weather',
  fields: WEATHER_SOURCE_FIELDS,
  async fetch({ location, units, days }, { signal }): Promise<WeatherData> {
    if (!location.trim()) return emptyWeather(units);
    const place = await geocode(location, signal);
    if (!place) return emptyWeather(units);
    const res = await sourceFetch(`https://api.open-meteo.com/v1/forecast?${forecastParams(place.lat, place.lon, units, days)}`, { headers }, { signal });
    return mapForecast(await res.json(), place.name, units, days);
  },
});

async function loadFeed(url: string, signal: AbortSignal): Promise<Feed> {
  const res = await sourceFetch(url, { headers: { ...headers, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } }, { signal });
  const text = await res.text();
  return parseFeed(text.length > MAX_FEED_BYTES ? text.slice(0, MAX_FEED_BYTES) : text, new URL(url).hostname);
}

export const rssSource = defineSource<{ urls: string; max: number }>({
  id: 'feeds-rss',
  fields: RSS_SOURCE_FIELDS,
  async fetch({ urls, max }, { signal }): Promise<FeedItem[]> {
    const list = feedUrls(urls);
    if (list.length === 0) return [];
    const results = await Promise.allSettled(list.map((url) => loadFeed(url, signal)));
    const feeds = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (feeds.length === 0) throw (results[0] as PromiseRejectedResult).reason;
    return mergeFeeds(feeds, max);
  },
});

export const fxSource = defineSource<{ base: string; quote: string; days: number }>({
  id: 'feeds-fx',
  fields: FX_FIELDS,
  async fetch(config, { signal }): Promise<FxData> {
    const base = currencyCode(config.base, 'EUR');
    const quote = currencyCode(config.quote, 'BRL');
    if (base === quote) return { base, quote, dates: [], values: [] };
    const res = await sourceFetch(`https://api.frankfurter.app/${startDate(new Date(), config.days)}..?from=${base}&to=${quote}`, { headers }, { signal });
    return mapSeries(await res.json(), base, quote);
  },
});

export const specs: GridPanelSpec[] = [
  { kind: 'weather', fields: fields.weather, allowMultiple: true },
  { kind: 'rss', fields: fields.rss, allowMultiple: true },
  { kind: 'exchange-rate', fields: fields['exchange-rate'], allowMultiple: true },
];
export const sources: DataSource<any>[] = [weatherSource, rssSource, fxSource];
