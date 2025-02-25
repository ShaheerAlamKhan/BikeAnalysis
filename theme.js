// Theme Switcher functionality

// Function to initialize theme preferences
function initTheme() {
    // Get the toggle element
    const themeToggle = document.getElementById('theme-toggle');
    
    // Check for saved theme preference or prefer-color-scheme
    const savedTheme = localStorage.getItem('theme');
    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Set the initial theme based on saved preference or system preference
    if (savedTheme === 'dark' || (!savedTheme && prefersDarkScheme)) {
      document.body.classList.add('dark-theme');
      themeToggle.checked = true;
      updateMapStyle(true);
    } else {
      document.body.classList.remove('dark-theme');
      themeToggle.checked = false;
      updateMapStyle(false);
    }
    
    // Listen for toggle changes
    themeToggle.addEventListener('change', function() {
      if (this.checked) {
        document.body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
        updateMapStyle(true);
      } else {
        document.body.classList.remove('dark-theme');
        localStorage.setItem('theme', 'light');
        updateMapStyle(false);
      }
    });
  }
  
  // Function to update Mapbox map style based on theme
  function updateMapStyle(isDark) {
    // Only run if map is initialized
    if (typeof map !== 'undefined' && map) {
      try {
        // Change the map style based on theme
        const style = isDark ? 
          'mapbox://styles/mapbox/dark-v11' : 
          'mapbox://styles/mapbox/streets-v12';
        
        // Store current center and zoom
        const currentCenter = map.getCenter();
        const currentZoom = map.getZoom();
        
        // Update map style
        map.setStyle(style);
        
        // When style is loaded, update positions of circles
        map.once('style.load', function() {
          // Re-add the Boston and Cambridge bike lanes
          if (!map.getSource('boston_route')) {
            map.addSource('boston_route', {
              type: 'geojson',
              data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?outSR=%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D'
            });
            map.addLayer({
              id: 'bike-lanes-boston',
              type: 'line',
              source: 'boston_route',
              paint: {
                'line-color': isDark ? '#4CAF50' : 'green',
                'line-width': 3,
                'line-opacity': isDark ? 0.6 : 0.4
              }
            });
          }
          
          if (!map.getSource('cambridge_route')) {
            map.addSource('cambridge_route', {
              type: 'geojson',
              data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
            });
            map.addLayer({
              id: 'bike-lanes-cambridge',
              type: 'line',
              source: 'cambridge_route',
              paint: {
                'line-color': isDark ? '#7CB342' : '#32D400',
                'line-width': 3,
                'line-opacity': isDark ? 0.8 : 0.6
              }
            });
          }
          
          // Update circle positions
          setTimeout(() => {
            updatePositions(d3.selectAll('circle'));
          }, 100);
        });
        
        console.log(`Theme switched to ${isDark ? 'dark' : 'light'} mode`);
      } catch (error) {
        console.error('Error updating map style:', error);
      }
    }
  }
  
  // Initialize theme when DOM is loaded
  document.addEventListener('DOMContentLoaded', initTheme);