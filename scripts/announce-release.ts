/**
 * Announces a published package release to the BaryoDev org discussions (Announcements).
 * Generic and reusable across repos — parameterized entirely by env:
 *   PACKAGE  e.g. "@baryodev/pwa-kit"
 *   VERSION  e.g. "v0.3.0"
 *   NOTES    optional release notes (markdown)
 *   ANNOUNCE_TOKEN  PAT with Discussions write on BaryoDev/.github
 *
 * Idempotent: skips if a discussion with the same title already exists.
 */
const TOKEN = process.env.ANNOUNCE_TOKEN;
const PACKAGE = process.env.PACKAGE ?? "package";
const VERSION = (process.env.VERSION ?? "").replace(/^v/, "");
const NOTES = process.env.NOTES ?? "";
const REPO_ID = process.env.ANNOUNCE_REPO_ID ?? "R_kgDOQwINlA"; // BaryoDev/.github
const CATEGORY_ID = process.env.ANNOUNCE_CATEGORY_ID ?? "DIC_kwDOQwINlM4C0ZbS"; // Announcements
const REPO_SLUG = process.env.ANNOUNCE_REPO_SLUG ?? "BaryoDev/.github";

if (!TOKEN) {
  console.error("ANNOUNCE_TOKEN is required.");
  process.exit(1);
}

const title = `${PACKAGE} v${VERSION}`;
const body = [
  NOTES.trim() || `Released ${PACKAGE} v${VERSION}.`,
  "",
  "**Install**",
  "```bash",
  `npm i ${PACKAGE}@${VERSION}`,
  "```",
  "",
  "_Posted automatically on publish._",
].join("\n");

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "baryodev-announce",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

async function main(): Promise<void> {
  const search = await gql<{ search: { nodes: Array<{ title?: string }> } }>(
    `query($q:String!){ search(type:DISCUSSION, query:$q, first:20){ nodes{ ... on Discussion { title } } } }`,
    { q: `repo:${REPO_SLUG} in:title "${title}"` },
  );
  if (search.search.nodes.some((n) => n.title === title)) {
    console.log("Already announced:", title);
    return;
  }
  const created = await gql<{ createDiscussion: { discussion: { url: string } } }>(
    `mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){
       createDiscussion(input:{repositoryId:$repo, categoryId:$cat, title:$title, body:$body}){ discussion { url } }
     }`,
    { repo: REPO_ID, cat: CATEGORY_ID, title, body },
  );
  console.log("Announced:", created.createDiscussion.discussion.url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
