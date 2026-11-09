// Lendshed icon set: single source of truth.
// Original drawings on a 24 x 24 grid, 1.75 px stroke, round caps and joins,
// no fill unless stated, coloured with currentColor.
// Run `node design/build-icons.mjs` after editing to regenerate the .svg files
// and src/components/ui/icons.tsx.

export const icons = {
  // Navigation and controls
  search: `<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
  "chevron-down": `<path d="M6 9.5l6 6 6-6"/>`,
  "chevron-right": `<path d="M9.5 6l6 6-6 6"/>`,
  "arrow-left": `<path d="M19 12H5.5M11 6l-6 6 6 6"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  copy: `<rect x="9" y="9" width="11.5" height="11.5" rx="2"/><path d="M15 9V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2H9"/>`,
  "external-link": `<path d="M13.5 4H20v6.5M20 4l-9 9M17.5 14v4.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V8a1.5 1.5 0 0 1 1.5-1.5H10"/>`,
  eye: `<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>`,
  "eye-off": `<path d="M9.6 5.8A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M14 14.1a2.75 2.75 0 0 1-4.1-4.1M6.6 7.4C4 9.1 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.6 9.6 0 0 0 4.7-1.2M3.5 3.5l17 17"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.75v.01"/>`,
  alert: `<path d="M10.3 4.2L2.6 17.7A2 2 0 0 0 4.3 20.7h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.25v.01"/>`,

  // Status labels
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  "arrow-up-right": `<path d="M7 17L17 7M8.5 7H17v8.5"/>`,
  dot: `<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>`,
  pause: `<path d="M9 6.5v11M15 6.5v11"/>`,

  // Empty and error states
  toolbox: `<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8.5 8V6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 6v2M3 13h7M14 13h7"/><rect x="10" y="11.5" width="4" height="3" rx="1"/>`,
  "box-open": `<path d="M4.5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-8.5M4.5 10.5h15M4.5 10.5L2.5 6.5h7l2.5 4M19.5 10.5l2-4h-7L12 10.5M12 10.5v10"/>`,
  image: `<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.75"/><path d="M4 18l5-5 3.5 3.5 2.5-2.5 5 5"/>`,
  camera: `<path d="M4.5 7.5h2.8L9 5h6l1.7 2.5h2.8a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5z"/><circle cx="12" cy="13.25" r="3.5"/>`,
  "camera-off": `<path d="M9 5h6l1.7 2.5h2.8A1.5 1.5 0 0 1 21 9v8.5M18.5 20h-14A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5h1.8M9.6 10.6a3.5 3.5 0 0 0 4.9 4.9M3.5 3.5l17 17"/>`,
  "link-broken": `<path d="M9.5 8H7a4 4 0 0 0 0 8h2.5M14.5 8H17a4 4 0 0 1 0 8h-2.5M7.5 12h1.5M15 12h1.5M12 4v2.5M12 17.5V20"/>`,

  // Organizer area
  mail: `<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6.5L20.5 7"/>`,
  users: `<circle cx="9" cy="8.5" r="3.25"/><path d="M3 19.5a6 6 0 0 1 12 0M15.5 5.4a3.25 3.25 0 0 1 0 6.2M17.5 14a6 6 0 0 1 3.5 5.5"/>`,
  tag: `<path d="M3.5 4.5v6.6a1.5 1.5 0 0 0 .44 1.06l8.4 8.4a1.5 1.5 0 0 0 2.12 0l6.1-6.1a1.5 1.5 0 0 0 0-2.12l-8.4-8.4A1.5 1.5 0 0 0 11.1 3.5H4.5a1 1 0 0 0-1 1z"/><circle cx="8" cy="8" r="1.5"/>`,
  gauge: `<path d="M4.2 18a9 9 0 1 1 15.6 0"/><path d="M12 14.5l4-4.5"/><circle cx="12" cy="14.5" r="1.25"/>`,
};

// Where each icon is used, for the README and the preview page.
export const groups = {
  "Navigation and controls": ["search", "calendar", "chevron-down", "chevron-right", "arrow-left", "plus", "close", "copy", "external-link", "eye", "eye-off", "info", "alert"],
  "Status labels": ["clock", "check", "arrow-up-right", "alert", "dot", "pause", "eye", "eye-off"],
  "Empty and error states": ["toolbox", "box-open", "search", "image", "camera", "camera-off", "link-broken"],
  "Organizer area": ["mail", "users", "tag", "gauge"],
};
