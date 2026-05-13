import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["src/server.js"], { stdio: "inherit" }),
  spawn(process.execPath, ["src/collector.js"], { stdio: "inherit" }),
];

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      for (const other of children) {
        if (other !== child) other.kill("SIGTERM");
      }
      process.exitCode = code;
    }
  });
}

process.on("SIGINT", () => {
  for (const child of children) child.kill("SIGINT");
});
