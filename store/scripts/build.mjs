import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
await mkdir("dist/server", { recursive: true });
const files = await readdir("worker");
let source = "";
for (const file of files.filter((f) => f.endsWith(".js") && f !== "index.js"))
  source +=
    (await readFile("worker/" + file, "utf8")).replace(
      /^import\s[\s\S]*?;\r?\n/gm,
      "",
    ) + "\n";
source += (await readFile("worker/index.js", "utf8")).replace(
  /^import\s[\s\S]*?;\r?\n/gm,
  "",
);
await mkdir("dist/.openai", { recursive: true });
let manifest = "{}";
try {
  manifest = await readFile(".openai/hosting.json", "utf8");
} catch {}
await writeFile("dist/.openai/hosting.json", manifest);
await writeFile("dist/server/index.js", source);
console.log("Build: dist/server/index.js");
