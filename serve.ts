// serve.ts — tiny static server for the tutorial site. No deps.
// From the evals/ directory:
//   bun serve.ts          # port 8765
//   bun serve.ts 3000     # custom port

const port = Number(process.argv[2]) || 8765;
const root = `${import.meta.dir}/site`;

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(`${root}${path}`);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

console.log(`▸ tutorial site → http://localhost:${port}/`);
