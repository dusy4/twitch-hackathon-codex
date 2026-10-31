/** Original RaidRift artwork. No third-party game textures or icon assets. */
export function RiftMark() {
  return (
    <svg
      className="rift-mark"
      viewBox="0 0 24 28"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 1h12v4h4v18h-4v4H6v-4H2V5h4Z" fill="currentColor" />
      <path d="M8 5h8v18H8Z" fill="var(--obsidian)" />
      <path d="m13 6-4 9h4l-2 7 6-11h-5Z" fill="var(--crack)" />
    </svg>
  );
}

export function RiftWindow({
  color = "#b47bfa",
  joined = false,
}: {
  color?: string;
  joined?: boolean;
}) {
  // Server colours are data, never arbitrary CSS or markup.
  const shirt = /^#[\da-f]{6}$/i.test(color) ? color : "#b47bfa";
  return (
    <svg
      className="rift-window"
      viewBox="0 0 112 112"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path fill="#191322" d="M0 0h112v112H0Z" />
      <path fill="#241b30" d="M0 88h112v24H0Z" />
      <path stroke="#382840" d="m0 112 32-24m80 24L80 88M0 100h112" />
      <path fill="#35243f" d="M19 13h51v8h8v67H11V21h8Z" />
      <path fill="#64417b" d="M25 19h39v6h8v57H17V25h8Z" />
      <path fill="#a52bff" d="M27 25h35v6h5v51H22V31h5Z" />
      <path fill="#382045" d="M31 29h27v6h5v47H26V35h5Z" />
      <path
        fill="#51265f"
        d="M35 35h23v12H35Zm-5 20h22v8H30Zm20 13h13v14H50Z"
      />
      <path stroke="#f1c8ff" strokeWidth="2" d="M25 24h15m-20 9v14m46 5v15" />
      <path fill="#100b1b" d="M10 51h9v5h-9Zm52-34h8v9h-8Zm9 55h9v7h-9Z" />
      <path stroke="#a52bff" d="m14 62 3 3-3 7m53-40 5 4v7" />
      <g className="rift-motes" fill="#f1c8ff">
        <path d="M7 31h3v3H7Zm75-9h3v3h-3Zm8 37h2v2h-2ZM20 93h2v2h-2Z" />
        <path fill="#92ffe0" d="M89 82h3v3h-3Z" />
      </g>
      {joined && (
        <g className="voxel-hero">
          <path fill="#100b1b" d="M50 96h37v4H50Z" />
          <g className="voxel-body">
            <path fill="#30213d" d="M56 69h24v12H56Z" />
            <path fill="#e8bba5" d="M58 49h20v19H58Z" />
            <path fill="#bb8b83" d="M78 51h4v17h-4Z" />
            <path fill="#e8d9ff" d="M54 44h24v7H54Z" />
            <path fill="#8d61b0" d="M78 44h4v9h-4Z" />
            <path
              fill="#382840"
              d="M58 51h4v4h-4Zm14 5h3v4h-3Zm-10 0h3v4h-3Z"
            />
            <path fill="#ffdac2" d="M67 62h5v2h-5Z" />
            <path fill={shirt} d="M54 69h28v17H54Z" />
            <path
              fill="#100b1b"
              opacity=".3"
              d="M54 69h5v17h-5Zm23 0h5v17h-5Z"
            />
            <path fill="#e8bba5" d="M50 74h4v12h-4Zm32 0h4v12h-4Z" />
            <path fill="#f1c8ff" d="M65 72h6v6h-6Z" />
            <path fill="#62506f" d="M58 86h8v8h-8Zm13 0h8v8h-8Z" />
            <path fill="#d8c8e5" d="M56 94h10v4H56Zm15 0h10v4H71Z" />
          </g>
        </g>
      )}
    </svg>
  );
}

const paths: Record<string, string> = {
  jump: "M6 18V8m-4 4 4-4 4 4m4 0V2m-4 4 4-4 4 4M2 21h18",
  dance: "m8 4 4-2 4 2-4 2-4-2Zm4 2v7m0-4-7 3-2-3m9 1 7-3 2 3m-9 3-6 7m6-7 6 7",
  wave: "M6 13V6a2 2 0 0 1 4 0v6-9a2 2 0 0 1 4 0v9-7a2 2 0 0 1 4 0v9c0 4-2 7-6 7H9c-2 0-4-2-5-4l-2-4a2 2 0 0 1 4-1l1 2M21 2l1 3M2 3l1 3",
  sit: "M8 3h5v5H8Zm2 6v5h8v6m-8-6H5v-4m0 4v6m5-9h7",
  cheer:
    "M7 3h10v6c0 4-3 6-5 6s-5-2-5-6V3Zm0 2H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4m-4 3v5m-5 1h10",
  arrow: "M12 18V5m-5 5 5-5 5 5",
  send: "m5 4 15 8-15 8 3-8-3-8Zm3 8h12",
  close: "m6 6 12 12M6 18 18 6",
  link: "m10 8 2-2a5 5 0 0 1 7 7l-2 2m-3 1-2 2a5 5 0 0 1-7-7l2-2m1 7 8-8",
  clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
};

export function Icon({ name }: { name: string }) {
  return (
    <svg
      className={`icon icon-${name}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
