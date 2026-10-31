export async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) {
      input += String(chunk);
      if (input.length > 256) throw new Error("Input too long");
    }
    return input.replace(/\r?\n$/, "");
  }
  return new Promise((resolve, reject) => {
    const chars: string[] = [];
    process.stderr.write("New password (input hidden): ");
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", handler);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(chars.join(""));
    };
    const handler = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          finish(new Error("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") chars.pop();
        else if (char >= " ") {
          chars.push(char);
          if (chars.length > 128) {
            finish(new Error("Input too long"));
            return;
          }
        }
      }
    };
    process.stdin.on("data", handler);
  });
}
