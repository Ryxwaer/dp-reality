<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import krajeGeoJson from '~/assets/maps/cz-kraje.geo.json'
import type { ListingsMapResponse, MapListing } from '~~/server/api/stats/listings-heatmap.get'

const props = defineProps<{
  data: ListingsMapResponse
  binColors: readonly string[]
}>()

const mapRoot = useTemplateRef<HTMLElement | null>('mapRoot')

let map: L.Map | null = null
let cluster: L.MarkerClusterGroup | null = null
let overlay: L.GeoJSON | null = null

const formatPrice = (n: number) => {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M Kč`
  if (n >= 1_000) return `${Math.round(n / 1_000)} k Kč`
  return `${n} Kč`
}

function readVar(name: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function styleKraj(): L.PathOptions {
  return {
    color: readVar('--ui-border-accented', '#3f3f46'),
    weight: 1,
    opacity: 0.9,
    fillColor: readVar('--ui-bg-elevated', '#1f1f23'),
    fillOpacity: 0.45
  }
}

function priceBin(price: number): number {
  const breakpoints = props.data.breakpoints
  for (let i = 0; i < breakpoints.length; i++) {
    if (price <= breakpoints[i]!) return i
  }
  return breakpoints.length
}

function binFromMarkers(markers: L.Marker[]): number {
  // Cluster colour = bin of the cluster's median price. Picking the median
  // child rather than the mean keeps a single luxury villa from re-tinting
  // an entire neighbourhood.
  const prices = markers
    .map(m => (m.options as L.MarkerOptions & { price?: number }).price)
    .filter((p): p is number => typeof p === 'number')
    .sort((a, b) => a - b)
  if (!prices.length) return 2
  const median = prices[Math.floor(prices.length / 2)]!
  return priceBin(median)
}

function buildPopup(l: MapListing): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!
  ))
  const disp = l.disposition ? `<span class="popup-meta">${escape(l.disposition)}</span>` : ''
  const locality = l.locality ? `<div class="popup-locality">${escape(l.locality)}</div>` : ''
  return `
    <div class="popup">
      <div class="popup-price">${formatPrice(l.price)}</div>
      ${disp}
      <a class="popup-title" href="${escape(l.url)}" target="_blank" rel="noopener noreferrer">
        ${escape(l.title)}
      </a>
      ${locality}
    </div>
  `
}

function makeMarker(l: MapListing): L.CircleMarker {
  const bin = priceBin(l.price)
  const marker = L.circleMarker([l.lat, l.lon], {
    radius: 5,
    weight: 1,
    color: '#0a0a0a',
    fillColor: props.binColors[bin],
    fillOpacity: 0.9,
    opacity: 0.6
  }) as L.CircleMarker & { options: L.CircleMarkerOptions & { price: number } }
  marker.options.price = l.price
  marker.bindPopup(() => buildPopup(l), {
    autoPan: true,
    closeButton: true,
    minWidth: 220,
    maxWidth: 280
  })
  return marker
}

function renderMarkers() {
  if (!map) return
  if (cluster) {
    map.removeLayer(cluster)
    cluster = null
  }
  if (!props.data.listings.length) return

  cluster = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 80,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 14,
    maxClusterRadius: 60,
    iconCreateFunction: (c) => {
      const bin = binFromMarkers(c.getAllChildMarkers() as L.Marker[])
      const color = props.binColors[bin]
      const count = c.getChildCount()
      const size = count < 10 ? 32 : count < 100 ? 38 : count < 1000 ? 46 : 54
      return L.divIcon({
        html: `<div class="cluster-bubble" style="background:${color}">${count.toLocaleString()}</div>`,
        className: 'cluster-icon',
        iconSize: L.point(size, size)
      })
    }
  })

  cluster.addLayers(props.data.listings.map(makeMarker) as unknown as L.Layer[])
  map.addLayer(cluster)
}

// `data` is replaced as a fresh object whenever useFetch in the parent settles,
// so a shallow watch on the reference is enough — no `deep: true` needed.
watch(() => props.data, () => {
  renderMarkers()
})

onMounted(() => {
  if (!mapRoot.value) return

  map = L.map(mapRoot.value, {
    zoomControl: true,
    attributionControl: true,
    minZoom: 6,
    maxZoom: 18,
    zoomSnap: 0.25,
    preferCanvas: true
  })
  map.attributionControl.setPosition('bottomleft')

  overlay = L.geoJSON(krajeGeoJson as GeoJSON.GeoJsonObject, {
    style: styleKraj,
    interactive: false
  }).addTo(map)

  // Transparent label-only raster tiles (CARTO dark variant). Lives in its own
  // pane above markers so place names stay readable. No API key needed.
  map.createPane('labels')
  const labelsPane = map.getPane('labels')!
  labelsPane.style.zIndex = '650'
  labelsPane.style.pointerEvents = 'none'

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    {
      pane: 'labels',
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 20
    }
  ).addTo(map)

  map.setMaxBounds(overlay.getBounds().pad(0.25))
  map.fitBounds(overlay.getBounds(), { padding: [12, 12] })

  // Belt-and-braces invalidate on the next frame in case the parent's flex
  // layout reflows once more after our mount (Leaflet caches container size).
  requestAnimationFrame(() => map?.invalidateSize({ animate: false }))

  if (props.data.listings.length) renderMarkers()
})

onBeforeUnmount(() => {
  if (map) {
    map.remove()
    map = null
  }
  cluster = null
  overlay = null
})
</script>

<template>
  <div ref="mapRoot" class="map-root h-112 w-full" />
</template>

<style scoped>
.map-root {
  background: var(--ui-bg);
  border-radius: 0 0 var(--ui-radius) var(--ui-radius);
}

.map-root :deep(.leaflet-container) {
  background: var(--ui-bg);
  font-family: inherit;
}

.map-root :deep(.leaflet-control-zoom a) {
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
  border-color: var(--ui-border);
}

.map-root :deep(.leaflet-control-attribution) {
  background: color-mix(in srgb, var(--ui-bg-elevated) 80%, transparent);
  color: var(--ui-text-muted);
  font-size: 10px;
}

.map-root :deep(.leaflet-control-attribution a) {
  color: var(--ui-text-muted);
}

/* --- Cluster bubbles ------------------------------------------------ */
.map-root :deep(.cluster-icon) {
  background: transparent;
  border: none;
}

.map-root :deep(.cluster-bubble) {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border-radius: 9999px;
  color: #fff;
  font-weight: 600;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  box-shadow:
    0 0 0 4px color-mix(in srgb, currentColor 20%, transparent),
    0 4px 12px rgb(0 0 0 / 0.4);
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
}

/* --- Popup styling -------------------------------------------------- */
.map-root :deep(.leaflet-popup-content-wrapper) {
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
}

.map-root :deep(.leaflet-popup-tip) {
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
}

.map-root :deep(.leaflet-popup-content) {
  margin: 10px 12px;
  font-size: 12px;
  line-height: 1.4;
}

.map-root :deep(.popup-price) {
  font-size: 16px;
  font-weight: 600;
  color: var(--ui-text-highlighted);
}

.map-root :deep(.popup-meta) {
  display: inline-block;
  margin-top: 2px;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-text) 8%, transparent);
  color: var(--ui-text-muted);
  font-size: 11px;
}

.map-root :deep(.popup-title) {
  display: block;
  margin-top: 6px;
  color: var(--ui-primary);
  text-decoration: none;
  font-weight: 500;
}

.map-root :deep(.popup-title:hover) {
  text-decoration: underline;
}

.map-root :deep(.popup-locality) {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.35;
}
</style>
