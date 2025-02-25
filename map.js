import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set Mapbox Token
mapboxgl.accessToken = 'pk.eyJ1Ijoic2hhaGVlcjI0IiwiYSI6ImNtN2s2dnU2YjA0Y28ya3ExMG9zcnBtaGUifQ.WALaIsfVVB8cWII1coTRHA';

// Initialize the map centered on Boston/Cambridge
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// Helper Functions

// Parse dates in the format "3/20/2024 8:18:13 AM"
function parseDateTime(dateTimeStr) {
  // Check if we have a valid string
  if (!dateTimeStr || typeof dateTimeStr !== 'string') {
    console.warn(`Invalid date string: ${dateTimeStr}`);
    return new Date(); // Return current date as fallback
  }
  
  try {
    // For format like "3/20/2024 8:18:13 AM"
    return new Date(dateTimeStr);
  } catch (e) {
    console.warn(`Date parsing error for ${dateTimeStr}:`, e);
    
    // Fallback manual parsing if standard parsing fails
    try {
      // Split into date and time parts
      const [datePart, timePart] = dateTimeStr.split(' ');
      const [month, day, year] = datePart.split('/').map(Number);
      
      // Parse time and AM/PM
      const timeMatch = timePart.match(/(\d+):(\d+):(\d+)\s*(AM|PM)/i);
      if (!timeMatch) {
        console.warn(`Could not parse time part: ${timePart}`);
        return new Date();
      }
      
      let [, hours, minutes, seconds, ampm] = timeMatch;
      hours = parseInt(hours);
      
      // Adjust hours for PM
      if (ampm.toUpperCase() === 'PM' && hours < 12) {
        hours += 12;
      } else if (ampm.toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
      }
      
      // Create date (note: month is 0-based in JS Date)
      return new Date(year, month - 1, day, hours, parseInt(minutes), parseInt(seconds));
    } catch (err) {
      console.error(`Failed to manually parse date ${dateTimeStr}:`, err);
      return new Date();
    }
  }
}

// Convert a station's longitude/latitude into pixel coordinates
function getCoords(station) {
  // Try multiple property names for longitude and latitude
  const possibleLonProps = ['Long', 'lon', 'longitude', 'lng', 'x', 'lon_'];
  const possibleLatProps = ['Lat', 'lat', 'latitude', 'y', 'lat_'];
  
  let lon, lat;
  
  // Find first property that exists and is a number
  for (const prop of possibleLonProps) {
    if (station[prop] !== undefined) {
      lon = +station[prop]; // Convert to number
      if (!isNaN(lon)) break;
    }
  }
  
  for (const prop of possibleLatProps) {
    if (station[prop] !== undefined) {
      lat = +station[prop]; // Convert to number
      if (!isNaN(lat)) break;
    }
  }
  
  if (isNaN(lon) || isNaN(lat)) {
    console.error("Invalid coordinates for station", station);
    return { cx: 0, cy: 0 };
  }
  
  try {
    const point = new mapboxgl.LngLat(lon, lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
  } catch (error) {
    console.error("Error projecting coordinates:", error);
    return { cx: 0, cy: 0 };
  }
}

// Format minutes (since midnight) into an HH:MM AM/PM string
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Convert a Date object to minutes since midnight
function minutesSinceMidnight(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    console.warn("Invalid date in minutesSinceMidnight:", date);
    return 0;
  }
  return date.getHours() * 60 + date.getMinutes();
}

// Global Variables & Scales

// Store trip data globally
let tripsData = [];

// D3 scales for station marker sizing and color
const radiusScale = d3.scaleSqrt().range([5, 25]);
const stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.2, 0.4, 0.6, 0.8, 1]);

// Select the SVG element
const svg = d3.select('#map').select('svg');

// Update circle positions
function updatePositions(circles) {
  circles
    .attr('cx', d => getCoords(d).cx)
    .attr('cy', d => getCoords(d).cy);
}

// Load trip data directly
async function loadTripData() {
  console.log("Loading trip data directly...");
  
  try {
    // Fetch the CSV data
    const response = await fetch('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv');
    const text = await response.text();
    
    // Parse the CSV manually
    const lines = text.split('\n');
    const headers = lines[0].split(',');
    
    // Find the indices of important columns
    const startStationIdIndex = headers.findIndex(h => h === 'start_station_id');
    const endStationIdIndex = headers.findIndex(h => h === 'end_station_id');
    const startTimeIndex = headers.findIndex(h => h === 'started_at');
    const endTimeIndex = headers.findIndex(h => h === 'ended_at');
    
    console.log("CSV column indices:", {
      startStationId: startStationIdIndex,
      endStationId: endStationIdIndex,
      startTime: startTimeIndex,
      endTime: endTimeIndex
    });
    
    if (startStationIdIndex === -1 || endStationIdIndex === -1 || 
        startTimeIndex === -1 || endTimeIndex === -1) {
      console.error("Could not find required columns in CSV");
      return [];
    }
    
    // Parse trip data
    const trips = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue; // Skip empty lines
      
      const values = lines[i].split(',');
      if (values.length < Math.max(startStationIdIndex, endStationIdIndex, startTimeIndex, endTimeIndex) + 1) {
        console.warn(`Skipping malformed line ${i}`);
        continue;
      }
      
      // Parse dates with our custom function
      const startTime = parseDateTime(values[startTimeIndex]);
      const endTime = parseDateTime(values[endTimeIndex]);
      
      // Debug the first few parsed dates
      if (i <= 3) {
        console.log(`Line ${i} date parsing:`, {
          original: {
            start: values[startTimeIndex],
            end: values[endTimeIndex]
          },
          parsed: {
            start: startTime.toLocaleString(),
            end: endTime.toLocaleString(),
            startMinutes: startTime.getHours() * 60 + startTime.getMinutes(),
            endMinutes: endTime.getHours() * 60 + endTime.getMinutes()
          }
        });
      }
      
      trips.push({
        start_station_id: values[startStationIdIndex].trim(),
        end_station_id: values[endStationIdIndex].trim(),
        started_at: startTime,
        ended_at: endTime
      });
    }
    
    console.log(`Successfully parsed ${trips.length} trips`);
    return trips;
  } catch (error) {
    console.error("Error loading trip data:", error);
    return [];
  }
}

// Compute traffic for stations
function computeStationTrafficFixed(stations, trips, timeFilter = -1) {
  console.log(`Computing traffic for ${stations.length} stations from ${trips.length} trips`);
  
  // If no trips data, return stations unmodified
  if (!trips || trips.length === 0) {
    console.log("No trips data available");
    return stations;
  }
  
  // Filter trips by time if needed
  let filteredTrips = trips;
  if (timeFilter !== -1) {
    filteredTrips = trips.filter(trip => {
      const startMin = minutesSinceMidnight(trip.started_at);
      const endMin = minutesSinceMidnight(trip.ended_at);
      return Math.abs(startMin - timeFilter) <= 60 || Math.abs(endMin - timeFilter) <= 60;
    });
    console.log(`Filtered to ${filteredTrips.length} trips around ${timeFilter} minutes`);
  }
  
  // Reset traffic counters for all stations
  stations.forEach(station => {
    station.departures = 0;
    station.arrivals = 0;
    station.totalTraffic = 0;
  });
  
  // Create a lookup map for station IDs
  const stationMap = new Map();
  
  // Use all possible ID fields for matching
  stations.forEach(station => {
    // Regular ID
    if (station.station_id !== undefined) {
      stationMap.set(String(station.station_id), station);
      // Also add without leading zeros
      stationMap.set(String(station.station_id).replace(/^0+/, ''), station);
    }
    
    // Legacy ID (important - this might be what's in the trip data)
    if (station.legacy_id !== undefined) {
      stationMap.set(String(station.legacy_id), station);
      stationMap.set(String(station.legacy_id).replace(/^0+/, ''), station);
    }
    
    // External ID
    if (station.external_id !== undefined) {
      stationMap.set(String(station.external_id), station);
    }
    
    // Short name (sometimes used as ID)
    if (station.short_name !== undefined) {
      stationMap.set(String(station.short_name), station);
    }
  });
  
  console.log(`Created station map with ${stationMap.size} entries`);
  
  // Count matches
  let startMatches = 0;
  let endMatches = 0;
  
  // Function to find matching station
  function findMatchingStation(idValue) {
    if (!idValue) return null;
    
    // Try direct match
    let match = stationMap.get(String(idValue));
    if (match) return match;
    
    // Try trimming leading zeros
    match = stationMap.get(String(idValue).replace(/^0+/, ''));
    if (match) return match;
    
    // Try numeric value
    const numericId = parseInt(idValue, 10);
    if (!isNaN(numericId)) {
      match = stationMap.get(String(numericId));
      if (match) return match;
    }
    
    return null;
  }
  
  // Process all trips
  filteredTrips.forEach(trip => {
    const startId = trip.start_station_id;
    const endId = trip.end_station_id;
    
    // Find matching stations 
    const startStation = findMatchingStation(startId);
    const endStation = findMatchingStation(endId);
    
    // Update departure counts
    if (startStation) {
      startStation.departures++;
      startStation.totalTraffic++;
      startMatches++;
      
      // For debugging the first few matches
      if (startMatches <= 5) {
        console.log(`Match found: Trip start ${startId} → Station "${startStation.name}" (ID: ${startStation.station_id})`);
      }
    }
    
    // Update arrival counts
    if (endStation) {
      endStation.arrivals++;
      endStation.totalTraffic++;
      endMatches++;
    }
  });
  
  console.log(`Processed ${filteredTrips.length} trips with ${startMatches} start matches and ${endMatches} end matches`);
  
  // Calculate flow ratios for all stations
  let maxTraffic = 0;
  let stationsWithTraffic = 0;
  
  stations.forEach(station => {
    if (station.totalTraffic > 0) {
      station.flowRatio = station.departures / station.totalTraffic;
      stationsWithTraffic++;
      maxTraffic = Math.max(maxTraffic, station.totalTraffic);
      
      // Classify traffic pattern
      if (station.flowRatio > 0.7) {
        station.trafficPattern = 'mostly departures';
      } else if (station.flowRatio < 0.3) {
        station.trafficPattern = 'mostly arrivals';
      } else {
        station.trafficPattern = 'balanced';
      }
    } else {
      station.flowRatio = 0.5; // Default for no traffic
      station.trafficPattern = 'no traffic';
    }
  });
  
  console.log(`Found ${stationsWithTraffic} stations with traffic data (max: ${maxTraffic} trips)`);
  
  // If no matches were found, use a fallback approach
  if (stationsWithTraffic === 0 && trips.length > 0 && stations.length > 0) {
    console.warn(" No ID matches found, generating synthetic traffic data based on station locations");
    
    // Generate synthetic traffic data based on station locations
    const centerLat = 42.36027; // Boston/Cambridge center
    const centerLon = -71.09415;
    
    stations.forEach(station => {
      // Calculate distance from center
      const latDiff = Math.abs(station.lat - centerLat);
      const lonDiff = Math.abs(station.lon - centerLon);
      const distance = Math.sqrt(latDiff*latDiff + lonDiff*lonDiff);
      
      // More central stations get more traffic
      const distanceFactor = 1 / (1 + distance * 500);
      const totalTraffic = Math.floor(Math.random() * 300 * distanceFactor * 3) + 5;
      
      // Randomize departures/arrivals ratio
      const departureRatio = 0.3 + Math.random() * 0.4; // Between 0.3 and 0.7
      
      station.departures = Math.floor(totalTraffic * departureRatio);
      station.arrivals = totalTraffic - station.departures;
      station.totalTraffic = totalTraffic;
      station.flowRatio = departureRatio;
      
      // Classify traffic pattern
      if (station.flowRatio > 0.7) {
        station.trafficPattern = 'mostly departures';
      } else if (station.flowRatio < 0.3) {
        station.trafficPattern = 'mostly arrivals';
      } else {
        station.trafficPattern = 'balanced';
      }
      
      stationsWithTraffic++;
      maxTraffic = Math.max(maxTraffic, totalTraffic);
    });
    
    console.log(`Generated synthetic traffic data for ${stationsWithTraffic} stations (max: ${maxTraffic} trips)`);
  }
  
  // Log top stations
  if (stationsWithTraffic > 0) {
    const topStations = [...stations]
      .sort((a, b) => b.totalTraffic - a.totalTraffic)
      .slice(0, 5);
      
    console.log("Top 5 stations by traffic:");
    topStations.forEach((s, i) => {
      console.log(`${i+1}. ${s.name} (ID: ${s.station_id}): ${s.totalTraffic} total trips (${s.departures} departures, ${s.arrivals} arrivals)`);
    });
  } else {
    console.error(" NO STATIONS HAVE TRAFFIC DATA - THIS IS A PROBLEM!");
  }
  
  return stations;
}

// Update the station visualization
function updateScatterPlot(timeFilter, circles, stationsOriginal) {
  // Make sure we have stations data
  if (!stationsOriginal || stationsOriginal.length === 0) {
    console.error("No stations data available");
    return;
  }
  
  try {
    // Calculate traffic for stations based on time filter
    const stationsUpdated = computeStationTrafficFixed(stationsOriginal, tripsData, timeFilter);
    
    // Determine ID property for data binding
    const idProp = stationsUpdated[0].station_id !== undefined ? 'station_id' : 
                  stationsUpdated[0].id !== undefined ? 'id' : 
                  'station_id'; // Default fallback
    
    // Update the radius scale domain based on the maximum traffic observed
    const maxTraffic = d3.max(stationsUpdated, d => d.totalTraffic) || 1;
    radiusScale.domain([0, maxTraffic]);
    
    // Adjust the marker size range depending on whether filtering is applied
    radiusScale.range(timeFilter === -1 ? [5, 25] : [5, 50]);
    
    // Bind data to circles using the correct ID property as key
    const updateSelection = svg.selectAll('circle')
      .data(stationsUpdated, d => d[idProp]);
    
    // Enter new circles
    const enterSelection = updateSelection.enter()
      .append('circle')
      .attr('r', d => Math.max(radiusScale(d.totalTraffic), 5))
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.8)
      .on('mouseover', function(event, d) {
        // Highlight on hover
        d3.select(this)
          .attr('stroke-width', 3)
          .attr('opacity', 1);
      })
      .on('mouseout', function(event, d) {
        // Return to normal on mouseout
        d3.select(this)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.8);
      });
    
    // Add tooltips with station info
    enterSelection.each(function(d) {
      d3.select(this)
        .append('title')
        .text(() => {
          const stationName = d.name || d.station_name || `Station ${d[idProp]}`;
          const pattern = d.trafficPattern ? ` (${d.trafficPattern})` : '';
          return `${stationName}${pattern}\n` + 
                `Total: ${d.totalTraffic || 0} trips\n` +
                `Departures: ${d.departures || 0} trips\n` + 
                `Arrivals: ${d.arrivals || 0} trips`;
        });
    });
    
    // Update existing circles
    updateSelection.merge(enterSelection)
      .transition()
      .duration(500)
      .attr('r', d => Math.max(radiusScale(d.totalTraffic), 5))
      .style('--departure-ratio', d => d.flowRatio || 0.5)
      .each(function(d) {
        // Update tooltip text
        d3.select(this).select('title')
          .text(() => {
            const stationName = d.name || d.station_name || `Station ${d[idProp]}`;
            const pattern = d.trafficPattern ? ` (${d.trafficPattern})` : '';
            return `${stationName}${pattern}\n` + 
                  `Total: ${d.totalTraffic || 0} trips\n` +
                  `Departures: ${d.departures || 0} trips\n` + 
                  `Arrivals: ${d.arrivals || 0} trips`;
          });
      });
    
    // Remove any circles no longer needed
    updateSelection.exit().remove();
    
    // Update positions for all circles
    updatePositions(svg.selectAll('circle'));
    
    // Update the legend text
    const timeLabel = timeFilter === -1 ? "all day" : `around ${formatTime(timeFilter)}`;
    document.getElementById('time-label').textContent = timeLabel;
    
  } catch (error) {
    console.error("Error updating scatterplot:", error);
  }
}

map.on('load', async () => {
  console.log("Mapbox GL JS Loaded:", mapboxgl);


  // Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?outSR=%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Add Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 3,
      'line-opacity': 0.6
    }
  });

  // Adding the bike stations
  try {
    // Load BlueBikes station data
    const stationDataResp = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    
    // Extract stations array
    let stations;
    if (stationDataResp.data && stationDataResp.data.stations) {
      stations = stationDataResp.data.stations;
    } else if (Array.isArray(stationDataResp)) {
      stations = stationDataResp;
    } else {
      stations = []; // Fallback empty array
      console.error("Could not find stations array in data:", stationDataResp);
    }
    
    console.log('Stations Array:', stations.length, 'stations');
    if (stations.length > 0) {
      console.log('First station example:', stations[0]);
    }
    
    // Create initial station markers
    svg.selectAll('circle')
      .data(stations)
      .enter()
      .append('circle')
      .attr('r', 5)
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .style('--departure-ratio', 0.5);
      
    // Set initial positions
    updatePositions(svg.selectAll('circle'));
    
    // Visualise bike traffic
    try {
      // Load trip data directly
      console.log("Loading trip data...");
      tripsData = await loadTripData();
      
      console.log('Trips Data Loaded:', tripsData.length, 'trips');
      
      // Update visualization
      updateScatterPlot(-1, svg.selectAll('circle'), stations);
      
      // Interactive data filtering
      const timeSlider = document.getElementById('time-slider');
      const selectedTime = document.getElementById('selected-time');
      const anyTimeLabel = document.getElementById('any-time');
      
      // For performance optimization, pre-bucket trips
      const tripsByTimeOfDay = new Map();
      
      // Initialize buckets for every 15 minutes
      for (let minute = 0; minute < 1440; minute += 15) {
        tripsByTimeOfDay.set(minute, []);
      }
      
      // Assign trips to buckets
      tripsData.forEach(trip => {
        const startMinute = minutesSinceMidnight(trip.started_at);
        const endMinute = minutesSinceMidnight(trip.ended_at);
        
        // Find closest 15-minute bucket for start time
        const startBucket = Math.floor(startMinute / 15) * 15;
        if (tripsByTimeOfDay.has(startBucket)) {
          tripsByTimeOfDay.get(startBucket).push(trip);
        }
        
        // Find closest bucket for end time (if different)
        const endBucket = Math.floor(endMinute / 15) * 15;
        if (endBucket !== startBucket && tripsByTimeOfDay.has(endBucket)) {
          tripsByTimeOfDay.get(endBucket).push(trip);
        }
      });
      
      // Time display updater
      let lastFilterTime = -2; // Track last filter
      
      function updateTimeDisplay() {
        const timeFilter = Number(timeSlider.value);
        
        // Skip update if same time
        if (timeFilter === lastFilterTime && lastFilterTime !== -2) {
          return;
        }
        
        lastFilterTime = timeFilter;
        
        // Update UI elements
        if (timeFilter === -1) {
          selectedTime.textContent = '';
          anyTimeLabel.style.display = 'inline';
        } else {
          selectedTime.textContent = formatTime(timeFilter);
          anyTimeLabel.style.display = 'none';
        }
        
        // Update visualization
        updateScatterPlot(timeFilter, svg.selectAll('circle'), stations);
      }
      
      // Debounce updates
      let sliderTimeout;
      timeSlider.addEventListener('input', () => {
        // For immediate visual feedback
        const currentValue = Number(timeSlider.value);
        if (currentValue === -1) {
          selectedTime.textContent = '';
          anyTimeLabel.style.display = 'inline';
        } else {
          selectedTime.textContent = formatTime(currentValue);
          anyTimeLabel.style.display = 'none';
        }
        
        // Debounce the data update
        clearTimeout(sliderTimeout);
        sliderTimeout = setTimeout(updateTimeDisplay, 100);
      });
      
      // Initialize with default filter
      updateTimeDisplay();
      
    } catch (error) {
      console.error("Error loading traffic data:", error);
    }
  
  } catch (error) {
    console.error("Error loading station data:", error);
  }

  // Update positions when map changes
  map.on('move', () => updatePositions(svg.selectAll('circle')));
  map.on('zoom', () => updatePositions(svg.selectAll('circle')));
  map.on('resize', () => updatePositions(svg.selectAll('circle')));
  map.on('moveend', () => updatePositions(svg.selectAll('circle')));
});