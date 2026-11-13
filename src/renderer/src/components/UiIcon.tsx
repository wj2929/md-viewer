const icons = {
  document: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  'document-edit': <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M7 7h4M7 11h2" /><path d="m19 5 3 3-9 9-4 1 1-4zM17 7l3 3" /></>,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  'folder-open': <><path d="M3 18V5a2 2 0 0 1 2-2h5l2 3h6a2 2 0 0 1 2 2v2" /><path d="M3 20h15a2 2 0 0 0 2-1.5L23 10H7l-4 9a1 1 0 0 0 1 1Z" /></>,
  pin: <><path d="m16 3 5 5-4 1-4 4v4l-2 2-6-6 2-2h4l4-4zM8 16l-5 5" /></>,
  settings: <><path d="m9.5 3-.7 2.4-1.5.9-2.4-.6-2.5 4.3 1.7 1.8v1.8l-1.7 1.8 2.5 4.3 2.4-.6 1.5.9.7 2.4h5l.7-2.4 1.5-.9 2.4.6 2.5-4.3-1.7-1.8v-1.8l1.7-1.8-2.5-4.3-2.4.6-1.5-.9L14.5 3z" /><circle cx="12" cy="12" r="3" /></>,
  auto: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />,
  volume: <><path d="M11 4 6 8H3v8h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 3l1 3M4 12l1 3a8 8 0 0 0 13 3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  star: <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2-4.5-4.4 6.3-.9z" />,
}

export type UiIconName = keyof typeof icons

/** Functional icons use local SVG geometry rather than system Emoji fonts. */
export function UiIcon({ name }: { name: UiIconName }): JSX.Element {
  return (
    <svg
      className="ui-icon"
      data-icon={name}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ verticalAlign: '-0.125em', flexShrink: 0 }}
    >
      {icons[name]}
    </svg>
  )
}
