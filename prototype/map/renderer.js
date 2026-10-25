"use strict";

window.SignalHuntMap = {
  mount(container, { markers, locale, theme, onSelect }) {
    if (!window.L || !window.SignalHuntMapData) {
      container.textContent =
        locale === "pl"
          ? "Mapa jest niedostępna. Skorzystaj z listy lub współrzędnych."
          : "Map unavailable. Use the list or checkpoint coordinates.";
      return null;
    }

    const bounds = window.SignalHuntMapData.metadata.bounds;
    const coverage = L.latLngBounds(
      [bounds.minlat, bounds.minlon],
      [bounds.maxlat, bounds.maxlon],
    );
    if (markers.some((marker) => !coverage.contains(marker.position))) {
      container.textContent =
        locale === "pl"
          ? "Cel poza zasięgiem mapy. Skorzystaj ze współrzędnych lub nawigacji zewnętrznej."
          : "Target outside map coverage. Use coordinates or external navigation.";
      return null;
    }

    const map = L.map(container, {
      attributionControl: false,
      zoomControl: false,
      minZoom: 15,
      maxZoom: 19,
      maxBounds: coverage,
      maxBoundsViscosity: 1,
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });
    const palette = (appearance) =>
      appearance === "dark"
        ? {
            ground: "#272c32",
            park: "#35463f",
            water: "#284a62",
            building: "#45474c",
            edge: "#595e66",
            street: "#8a929a",
            path: "#8c9d94",
          }
        : {
            ground: "#edf1ef",
            park: "#d2e4d6",
            water: "#c0dce8",
            building: "#e0ded9",
            edge: "#c8cbc7",
            street: "#ffffff",
            path: "#b9c4b5",
          };
    let colors = palette(theme);
    container.style.backgroundColor = colors.ground;

    const namedStreets = new Set();
    const shapes = L.geoJSON(window.SignalHuntMapData, {
      interactive: false,
      onEachFeature(feature, layer) {
        const { name, highway } = feature.properties;
        if (
          !name ||
          namedStreets.has(name) ||
          ![
            "primary",
            "secondary",
            "tertiary",
            "residential",
            "living_street",
          ].includes(highway)
        )
          return;
        namedStreets.add(name);
        const label = document.createElement("span");
        label.textContent = name;
        layer.bindTooltip(label, {
          permanent: true,
          direction: "center",
          className: "map-street-label",
          opacity: 1,
        });
      },
      style(feature) {
        const properties = feature.properties;
        if (properties.building) {
          return {
            fillColor: colors.building,
            fillOpacity: 1,
            color: colors.edge,
            weight: 0.7,
          };
        }
        if (properties.waterway || properties.natural === "water") {
          return {
            fillColor: colors.water,
            fillOpacity: 1,
            color: colors.water,
            weight: 2,
          };
        }
        if (properties.highway) {
          const walking = [
            "footway",
            "path",
            "pedestrian",
            "steps",
            "cycleway",
          ].includes(properties.highway);
          return {
            color: walking ? colors.path : colors.street,
            weight: walking ? 2 : 5,
            opacity: 1,
            dashArray: walking ? "3 4" : null,
            lineCap: "round",
          };
        }
        return {
          fillColor: colors.park,
          fillOpacity: 0.8,
          color: colors.park,
          weight: 1,
        };
      },
    }).addTo(map);

    markers.forEach((marker) => {
      const pin = L.marker(marker.position, {
        icon: L.divIcon({
          className: "map-pin-shell",
          html: `<span class="map-pin${marker.current ? " current" : ""}" data-number="${marker.number}"></span>`,
          iconSize: [36, 44],
          iconAnchor: [18, 40],
        }),
        title: marker.title,
        alt: marker.title,
        keyboard: true,
      }).addTo(map);
      pin.on("add", () =>
        pin.getElement().setAttribute("aria-label", marker.title),
      );
      if (onSelect) pin.on("click", () => onSelect(marker.id));
      else
        pin.bindTooltip(marker.title, { direction: "top", offset: [0, -36] });
    });

    L.control
      .zoom({
        position: "bottomright",
        zoomInTitle: locale === "pl" ? "Przybliż" : "Zoom in",
        zoomOutTitle: locale === "pl" ? "Oddal" : "Zoom out",
      })
      .addTo(map);
    L.control
      .attribution({ prefix: false, position: "bottomleft" })
      .addAttribution(
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      )
      .addTo(map);

    const recenter = () => {
      if (!markers.length)
        map.setView(coverage.getCenter(), 16, { animate: false });
      else if (markers.length === 1)
        map.setView(markers[0].position, 17, { animate: false });
      else
        map.fitBounds(
          markers.map((marker) => marker.position),
          { padding: [48, 48], maxZoom: 17, animate: false },
        );
    };
    recenter();
    container.setAttribute(
      "aria-label",
      locale === "pl"
        ? "Mapa OpenStreetMap. Zasięg ograniczony do obszaru demonstracyjnego."
        : "OpenStreetMap map. Coverage is limited to the demo area.",
    );
    return {
      remove: () => map.remove(),
      recenter,
      setTheme(appearance) {
        colors = palette(appearance);
        container.style.backgroundColor = colors.ground;
        shapes.setStyle(shapes.options.style);
      },
    };
  },
};
