import type { Database } from "./db.js";
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function publicDocument(
  template: string,
  path: string,
  db: Database,
  origin: string,
) {
  let title = "RaidRift — Small heroes. Shared worlds.",
    description =
      "Give your Twitch community a persistent voxel universe, shared quests and original dimensional portals.",
    content =
      "<h1>RaidRift — small heroes, shared worlds</h1><p>Turn raids into portals and viewers into persistent adventurers.</p>";
  if (path === "/leaderboard") {
    title = "Verified Shards leaderboard · RaidRift";
    description =
      "Public Rift Shards rankings from verified earned score. Spending on cosmetics does not reduce your competitive score.";
    const rows = (
      await db.query(
        `SELECT a.id,CASE WHEN a.privacy='anonymous' THEN 'Rift traveler' ELSE a.name END AS name,sum(l.score_delta)::text AS score FROM accounts a JOIN ledger l ON a.id=l.account_id WHERE a.privacy<>'hidden' AND a.deleted=false GROUP BY a.id HAVING sum(l.score_delta)>0 ORDER BY sum(l.score_delta) DESC,a.id LIMIT 50`,
      )
    ).rows;
    content = `<h1>RaidRift verified earnings leaderboard</h1><p>${description} Snapshot: all-time.</p><table><thead><tr><th>Hero</th><th>Verified Shards earned</th></tr></thead><tbody>${rows.map((r) => `<tr><td><a href="/players/${encodeURIComponent(r.id)}">${escape(r.name)}</a></td><td>${escape(r.score)}</td></tr>`).join("")}</tbody></table>`;
  } else if (path.startsWith("/players/")) {
    const id = decodeURIComponent(path.split("/")[2] || "");
    const row = (
      await db.query(
        `SELECT a.id,CASE WHEN a.privacy='anonymous' THEN 'Rift traveler' ELSE a.name END AS name,COALESCE(sum(l.score_delta),0)::text AS score FROM accounts a LEFT JOIN ledger l ON l.account_id=a.id WHERE a.id=$1 AND a.privacy<>'hidden' AND a.deleted=false GROUP BY a.id`,
        [id],
      )
    ).rows[0];
    if (row) {
      title = `${row.name} · RaidRift hero`;
      description = `${row.name}'s persistent adventurer profile. ${row.score} verified Rift Shards earned.`;
      content = `<h1>${escape(row.name)}</h1><p>${escape(row.score)} verified Shards earned.</p>`;
    } else {
      title = "Private or unavailable profile · RaidRift";
      content = "<h1>Private or unavailable profile</h1>";
    }
  } else if (path === "/live") {
    title = "Discover worlds · RaidRift";
    const rows = (
      await db.query(
        `SELECT id,config FROM channels WHERE config->>'public'='true' ORDER BY id LIMIT 50`,
      )
    ).rows;
    content = `<h1>Discover participating RaidRift worlds</h1><ul>${rows.map((r) => `<li><a href="/controller?room=${encodeURIComponent(r.id)}">${escape(r.config.title)}</a></li>`).join("")}</ul>`;
  }
  const canonical = `${origin}${path}`;
  return template
    .replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${escape(description)}">`,
    )
    .replace(
      "</head>",
      `<link rel="canonical" href="${escape(canonical)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:type" content="website"></head>`,
    )
    .replace(
      '<div id="app"></div>',
      `<div id="app"><main><nav><a href="/">Explore</a> · <a href="/leaderboard">Leaderboard</a> · <a href="/live">Worlds</a></nav>${content}<noscript>Interactive controllers and the 3D world need JavaScript. Public rankings above remain accessible.</noscript></main></div>`,
    );
}
