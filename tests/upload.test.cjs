const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  { stripTypeScriptTypes } = require("node:module"),
  path = require("node:path");
function server(allowed = true) {
  let handler,
    stored = 0;
  const source = fs
    .readFileSync(
      path.join(__dirname, "../supabase/functions/planner-upload/index.ts"),
      "utf8",
    )
    .replace(/^import .*;$/gm, "");
  const client = {
    auth: {
      getUser: async (token) =>
        token === "valid"
          ? { data: { user: { id: "owner" } }, error: null }
          : { data: { user: null }, error: Error("invalid") },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: allowed
              ? { work_state: { settings: { maxFileMB: 1 } } }
              : null,
            error: null,
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => {
          stored++;
          return { error: null };
        },
      }),
    },
  };
  const context = {
    Request,
    Response,
    File,
    FormData,
    Uint8Array,
    TextDecoder,
    crypto,
    console,
    createClient: () => client,
    WorkFiles: require("../file-rules.js"),
    Deno: {
      env: { get: (key) => key },
      serve: (f) => {
        handler = f;
      },
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(source), context);
  return { handler, stored: () => stored };
}
function upload(name, content, token = "valid") {
  const data = new FormData();
  data.append("file", new File([content], name));
  return new Request("https://local/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  });
}
test("upload endpoint rejects missing identity and disallowed account", async () => {
  const a = server();
  assert.equal(
    (await a.handler(upload("a.pdf", "%PDF-1.4", "bad"))).status,
    401,
  );
  assert.equal(a.stored(), 0);
  const b = server(false);
  assert.equal((await b.handler(upload("a.pdf", "%PDF-1.4"))).status, 403);
  assert.equal(b.stored(), 0);
});
test("upload endpoint validates bytes and size on server and returns stable owner path", async () => {
  const s = server();
  assert.equal((await s.handler(upload("a.pdf", "bad content"))).status, 400);
  assert.equal(
    (await s.handler(upload("a.pdf", "%PDF-" + "x".repeat(1100000)))).status,
    400,
  );
  const result = await s.handler(upload("../../renamed.pdf", "%PDF-1.4"));
  assert.equal(result.status, 200);
  const file = await result.json();
  assert.match(file.path, /^owner\/[\w-]+\.pdf$/);
  assert.equal(s.stored(), 1);
});
