import { readFileSync, writeFileSync } from "node:fs";

const inputPath = process.argv[2];
if (!inputPath)
  throw new Error("Usage: node prototype/map/build-data.mjs <osm-map.json>");
const source = JSON.parse(readFileSync(inputPath, "utf8"));
if (!source.bounds || !Array.isArray(source.elements))
  throw new Error("Expected an OSM bounding-box JSON extract");
const nodes = new Map(
  source.elements
    .filter((element) => element.type === "node")
    .map((node) => [node.id, [node.lon, node.lat]]),
);
const allowedTags = [
  "name",
  "highway",
  "building",
  "leisure",
  "landuse",
  "natural",
  "waterway",
];
const features = source.elements.flatMap((element) => {
  if (element.type !== "way" || !element.tags) return [];
  const tags = element.tags;
  if (
    !tags.highway &&
    !tags.building &&
    tags.leisure !== "park" &&
    tags.landuse !== "grass" &&
    tags.natural !== "water" &&
    !tags.waterway
  )
    return [];
  const coordinates = element.nodes.map((nodeId) => nodes.get(nodeId));
  if (coordinates.length < 2 || coordinates.some((coordinate) => !coordinate))
    return [];
  const closed =
    element.nodes[0] === element.nodes.at(-1) && coordinates.length >= 4;
  const polygon = closed && !tags.highway && !tags.waterway;
  return [
    {
      type: "Feature",
      id: `way/${element.id}`,
      properties: Object.fromEntries(
        allowedTags.filter((key) => tags[key]).map((key) => [key, tags[key]]),
      ),
      geometry: {
        type: polygon ? "Polygon" : "LineString",
        coordinates: polygon ? [coordinates] : coordinates,
      },
    },
  ];
});
features.sort((first, second) => {
  const rank = (feature) =>
    feature.properties.highway ? 2 : feature.properties.building ? 1 : 0;
  return rank(first) - rank(second);
});
if (!features.length) throw new Error("No renderable map features");
const data = {
  type: "FeatureCollection",
  metadata: {
    source: `https://api.openstreetmap.org/api/0.6/map.json?bbox=${source.bounds.minlon},${source.bounds.minlat},${source.bounds.maxlon},${source.bounds.maxlat}`,
    extractedAt: new Date().toISOString(),
    bounds: source.bounds,
    copyright: source.copyright,
    license: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "https://www.openstreetmap.org/copyright",
    scope:
      "Simplified ways only; relations and points of interest omitted. Not a routing dataset.",
  },
  features,
};
writeFileSync(
  new URL("./data.js", import.meta.url),
  `"use strict";\nwindow.SignalHuntMapData = ${JSON.stringify(data)};\n`,
);
console.log(`Generated ${features.length} local OSM features`);
