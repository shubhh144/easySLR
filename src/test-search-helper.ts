import fs from "fs";

const content = fs.readFileSync("./src/server/import/__tests__/import.test.ts", "utf-8");
const lines = content.split("\n");
const startLine = lines.findIndex(l => l.includes("function makeExistingArticle"));
if (startLine !== -1) {
  console.log(lines.slice(startLine, startLine + 25).join("\n"));
}
