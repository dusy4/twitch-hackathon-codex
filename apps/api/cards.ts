const xml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Original, self-contained vector art. No private wallet or external resource URLs. */
export function profileCard(
  player: { name: string; color: string; demo: boolean },
  earned: string,
  quests: number,
) {
  const color = /^#[0-9a-f]{6}$/i.test(player.color) ? player.color : "#ae80ff";
  const displayName = Array.from(player.name).slice(0, 40).join("");
  const nameSize = Math.min(
    58,
    Math.floor(700 / Math.max(1, Array.from(displayName).length * 0.62)),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc"><title id="title">${xml(player.name)} — RaidRift traveler</title><desc id="desc">${xml(earned)} lifetime earned Shards. ${quests} completed quests. ${player.demo ? "Simulator identity." : "Twitch-linked identity."}</desc><defs><linearGradient id="rift" x2="1" y2="1"><stop stop-color="#ae80ff"/><stop offset="1" stop-color="#7be8bf"/></linearGradient></defs><rect width="1200" height="630" fill="#10121b"/><rect x="30" y="30" width="1140" height="570" rx="24" fill="#1b1e29" stroke="#353949"/><path d="M858 120h160v300H858z" fill="#38244e" stroke="#74539e" stroke-width="22"/><path d="M880 150q120 60 0 120t0 120M920 145q100 70 0 140t0 120M970 150q-110 70 0 140t0 100" fill="none" stroke="url(#rift)" stroke-width="7" opacity=".7"/><text x="80" y="105" fill="#cfefdc" font-family="monospace" font-size="22" letter-spacing="4">RAIDRIFT / A TRAVELER’S TALE</text><text x="80" y="235" fill="#f2f1ec" font-family="sans-serif" font-size="${nameSize}" font-weight="bold">${xml(displayName)}</text><text x="80" y="305" fill="#b9bbce" font-family="monospace" font-size="20">${player.demo ? "SIMULATOR PLAYER" : "TWITCH-LINKED PLAYER"}</text><text x="80" y="420" fill="#cfefdc" font-family="sans-serif" font-size="66" font-weight="bold">${xml(BigInt(earned).toLocaleString("en-US"))} ◆</text><text x="80" y="460" fill="#b9bbce" font-family="monospace" font-size="18">LIFETIME EARNED SHARDS · ${quests} QUESTS</text><g transform="translate(995 375)"><rect x="-24" y="-60" width="60" height="60" fill="${color}"/><rect x="-18" y="0" width="48" height="52" fill="${color}"/><rect x="-32" y="2" width="14" height="40" fill="${color}"/><rect x="30" y="2" width="14" height="40" fill="${color}"/><path d="M-15 52h18v32h-18zM10 52h18v32H10z" fill="#ae80ff"/><rect x="-12" y="-37" width="8" height="8" fill="#10121b"/><rect x="16" y="-37" width="8" height="8" fill="#10121b"/></g><text x="80" y="555" fill="#ae80ff" font-family="sans-serif" font-size="20">Small heroes. Shared worlds.</text><text x="760" y="555" fill="#b9bbce" font-family="monospace" font-size="16">SHARED WITH PLAYER CONSENT</text></svg>`;
}
