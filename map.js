import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiaGtlbGxpbmd0b24iLCJhIjoiY213ZWh1a21tMDN4ejJ4cHEzNmQyYzF1YSJ9.BvMS4B5okGdMQiNB1n-d6A';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select('#map > svg');
const slider = document.getElementById('time-slider');
const playButton = document.getElementById('play-time');
const selectedTime = document.getElementById('selected-time');
const anyTime = document.getElementById('any-time');
const status = document.getElementById('map-status');
const departuresByMinute = Array.from({ length: 1440 }, () => new Map());
const arrivalsByMinute = Array.from({ length: 1440 }, () => new Map());
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function minuteOfDay(timestamp) {
  // The source timestamps are local Boston times, regardless of the viewer's timezone.
  const match = timestamp?.match(/\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function addTrip(buckets, timestamp, stationId) {
  const minute = minuteOfDay(timestamp);
  if (minute < 0 || minute >= 1440 || !stationId) return;
  const counts = buckets[minute];
  counts.set(stationId, (counts.get(stationId) ?? 0) + 1);
}

function countsInWindow(buckets, minute) {
  const totals = new Map();
  const start = minute === -1 ? 0 : -60;
  const end = minute === -1 ? 1439 : 60;
  for (let offset = start; offset <= end; offset++) {
    const index = minute === -1 ? offset : (minute + offset + 1440) % 1440;
    for (const [id, count] of buckets[index]) {
      totals.set(id, (totals.get(id) ?? 0) + count);
    }
  }
  return totals;
}

function computeStationTraffic(stations, minute = -1) {
  const departures = countsInWindow(departuresByMinute, minute);
  const arrivals = countsInWindow(arrivalsByMinute, minute);
  return stations.map((station) => {
    const departureCount = departures.get(station.short_name) ?? 0;
    const arrivalCount = arrivals.get(station.short_name) ?? 0;
    return { ...station, departures: departureCount, arrivals: arrivalCount, totalTraffic: departureCount + arrivalCount };
  });
}

function formatTime(minutes) {
  const date = new Date(2000, 0, 1, 0, minutes);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

map.on('load', async () => {
  const lanePaint = { 'line-color': 'green', 'line-width': 3, 'line-opacity': 0.4 };
  for (const [id, data] of [
    ['boston', 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'],
    ['cambridge', 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'],
  ]) {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({ id: `${id}-bike-lanes`, type: 'line', source: id, paint: lanePaint });
  }

  try {
    const [stationData] = await Promise.all([
      d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json'),
      d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', (trip) => {
        addTrip(departuresByMinute, trip.started_at, trip.start_station_id);
        addTrip(arrivalsByMinute, trip.ended_at, trip.end_station_id);
        return null;
      }),
    ]);
    const stations = stationData.data.stations;
    const allTraffic = computeStationTraffic(stations);
    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(allTraffic, (d) => d.totalTraffic) || 1]);

    function updatePositions() {
      svg.selectAll('circle')
        .attr('cx', (d) => map.project([+d.lon, +d.lat]).x)
        .attr('cy', (d) => map.project([+d.lon, +d.lat]).y);
    }

    function updateScatterPlot(minute) {
      const filtered = computeStationTraffic(stations, minute);
      radiusScale.range(minute === -1 ? [0, 25] : [3, 50]);
      const circles = svg.selectAll('circle')
        .data(filtered, (d) => d.short_name || d.station_id)
        .join('circle')
        .attr('r', (d) => d.totalTraffic ? radiusScale(d.totalTraffic) : 0)
        .style('--departure-ratio', (d) => stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5));
      circles.selectAll('title').data((d) => [d]).join('title')
        .text((d) => `${d.name}: ${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      updatePositions();
    }

    function updateTimeDisplay() {
      const minute = Number(slider.value);
      selectedTime.textContent = minute === -1 ? '' : formatTime(minute);
      anyTime.hidden = minute !== -1;
      updateScatterPlot(minute === 1440 ? 0 : minute);
    }

    map.on('move', updatePositions);
    map.on('resize', updatePositions);
    let playback = null;
    function stopPlayback() {
      clearInterval(playback);
      playback = null;
      playButton.textContent = 'Play';
    }

    playButton.addEventListener('click', () => {
      if (playback !== null) {
        stopPlayback();
        return;
      }
      if (Number(slider.value) < 0 || Number(slider.value) >= 1440) {
        slider.value = 0;
        updateTimeDisplay();
      }
      playButton.textContent = 'Pause';
      playback = setInterval(() => {
        slider.value = Math.min(Number(slider.value) + 60, 1440);
        updateTimeDisplay();
        if (Number(slider.value) >= 1440) stopPlayback();
      }, 1000);
    });
    slider.addEventListener('input', () => {
      stopPlayback();
      updateTimeDisplay();
    });
    updateTimeDisplay();
    playButton.disabled = false;
    status.textContent = '';
  } catch (error) {
    console.error('Unable to load Bluebikes data:', error);
    status.textContent = 'Unable to load station traffic. Please refresh the page to try again.';
  }
});
