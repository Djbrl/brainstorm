// How each map theme draws on the canvas, as data: files, imports, labels and agent markers (MapStyle, one per theme).
// Colours that also style the chrome (recency, accent) come from CSS variables set per theme in themes.css;
// this file holds what CSS can't reach. The current theme is read on every frame (getTheme()). The drawing that
// follows these styles is in marks.ts (a file's mark, an agent's) and routes.ts (the ways agents travel).
import { getTheme, type ThemeId } from "../lib/theme";

export type RGB = [number, number, number];

export type MapStyle = {
  /** How a file is drawn: a dot, a turning glass cube, a turning wireframe globe or a metro station. */
  node: "dot" | "cube" | "globe" | "station";
  /** Imports (the hovered or selected file's): plain lines, or metro lines (horizontal, vertical and 45°). */
  link: "line" | "metro";
  halo: string; fileInk: string; fileInkQuiet: string;
  labelFont?: string;
  imports: string; usedBy: string;
  markerStroke: string; markerText: string; glow: boolean;
  /** How an agent travels between files, and the shape of the trail it leaves (see routePoints):
   *  a straight glide (trails curve softly), metro track (Metro and Hologram), or a hop in an arc. */
  route: "glide" | "metro" | "hop";
  /** How thick an agent's track is, against the usual (Hologram: a fine line). */
  trackWidth?: number;
  /** Metro: the agent's own line (the main thread and a replay), in ink, apart from the folder colours. Others use the accent. */
  track?: string;
  /** Subagent colours (main threads take the theme's accent). */
  palette: string[];
  /** An agent's mark: a filled disc, or Metro's line badge (white, ringed in its colour). See drawMarker. */
  marker: "disc" | "badge";
  /** Metro: the colours folders take (a station is ringed in its folder's colour, a closed folder too). Only agents and
   *  the imports of the file you point at draw lines: a line between files would claim a link that isn't there. */
  lines?: string[];
  /** Metro: open folders drawn as fare zones (octagons, peach and cream by turns), named in this ink. */
  zoneInk?: string;
  /** A closed folder's name (the file names' strong ink otherwise). */
  folderInk?: string;
  /** How far a file's mark reaches from its centre, in radii: idle, and with an agent on it (its ring, its bigger cube).
   *  The layout keeps this clear between files and labels stay out of it (see reachOf). */
  reach: [number, number];
};

const BASE: MapStyle = {
  node: "dot", link: "line",
  halo: "rgba(249,249,247,0.9)", fileInk: "#121214", fileInkQuiet: "rgba(18,18,20,0.62)",
  imports: "rgba(37,99,235,0.7)", usedBy: "rgba(15,157,138,0.7)",
  markerStroke: "#fff", markerText: "#fff", glow: false, route: "glide",
  palette: ["#2f7ae5", "#0f9d8a", "#c2409a", "#7c4dde", "#2e9e4f", "#0b8fb3", "#b5487a", "#4a6fa5"],
  marker: "disc",
  reach: [1, 1.2],                       // a dot; the active outline sits 3.5px out
};

/** The RER's line colours (A red, B blue, C yellow, D green, E pink) and two more for big projects: folder colours. */
const RER = ["#e3051c", "#4f8fcf", "#f2bb00", "#00a07e", "#c04191", "#7b5aa6", "#6e9a2f"];
const FRUTIGER = `"Avenir Next Condensed", "Avenir Next", Frutiger, "Segoe UI", "Helvetica Neue", sans-serif`;

const STYLES: Record<ThemeId, MapStyle> = {
  default: BASE,
  metro: {
    ...BASE, node: "station", link: "metro", route: "metro", track: "#1d1d1b", marker: "badge",
    imports: "rgba(37,99,235,0.95)", usedBy: "rgba(15,157,138,0.95)",   // shown only around the file you point at or pick: near full strength
    halo: "rgba(253,249,236,0.95)", fileInk: "#1d1d1b", fileInkQuiet: "rgba(29,29,27,0.74)",
    labelFont: FRUTIGER,
    lines: RER, palette: RER, zoneInk: "#e2730e",
    reach: [0.72, 1.1],                  // a station is 0.6r plus its ring; an agent adds one more ring
  },
  prism: {
    ...BASE, node: "cube", route: "hop",
    halo: "rgba(22,22,52,0.85)", fileInk: "#f0f2ff", fileInkQuiet: "rgba(215,222,255,0.62)",
    labelFont: `"Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`,
    imports: "rgba(242,227,106,0.9)", usedBy: "rgba(140,200,255,0.9)",
    markerStroke: "rgba(255,255,255,0.95)", markerText: "#1b1b40", glow: true,
    palette: ["#8fb4ff", "#7ee0ff", "#ff9ff3", "#c7a6ff", "#9dffb0", "#ffe08a", "#ffb38a", "#a6f0ff"],
    marker: "disc",
    reach: [1.25, 1.95],                 // a turning cube's corners (0.78r, tilted); active: 1.3x and the floor ring
  },
  hologram: {
    ...BASE, node: "globe", route: "metro", trackWidth: 0.5,
    halo: "rgba(8,14,16,0.9)", fileInk: "#dcf6f8", fileInkQuiet: "rgba(160,205,215,0.6)",
    labelFont: `"Arial Narrow", "Helvetica Neue", sans-serif`,
    imports: "rgba(95,227,224,0.9)", usedBy: "rgba(140,146,255,0.9)",
    markerStroke: "#0b1214", markerText: "#0b1214", glow: true,
    palette: ["#5fe3e0", "#7cc8ff", "#b6f0ff", "#a9a4ff", "#3fc1c9", "#8fe9f0", "#c7b8ff", "#a3d8ff"],
    marker: "disc",
    reach: [0.95, 1.6],                  // a globe is 0.9r; active: 1.25x and the ring around it
  },
};

export const mapStyle = (): MapStyle => STYLES[getTheme()];

/** How far a file of radius r reaches on the canvas in this theme (graph units, never under 4: the smallest station). */
export const reachOf = (r: number, active = false, st = mapStyle()) => Math.max(4, r * st.reach[active ? 1 : 0]);
