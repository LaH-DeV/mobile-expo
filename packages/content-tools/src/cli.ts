import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { formatQrPayload } from "@signal-hunt/contracts";
import { loadContentDirectory } from "./load";

function main(argv: string[]): number {
  const [command, argument] = argv;
  if (command === "validate" && argument) {
    const directory = resolve(process.env.INIT_CWD ?? process.cwd(), argument);
    const result = loadContentDirectory(directory);
    if (!result.ok) {
      console.error(`Content in ${directory} is INVALID:`);
      for (const issue of result.issues) console.error(`  ${issue.path}: ${issue.message}`);
      return 1;
    }
    const label = result.release.synthetic ? "SYNTHETIC (public, not secret)" : "PRIVATE";
    console.log(`Content in ${directory} is valid [${label}].`);
    for (const hunt of result.release.hunts) {
      const versions = hunt.versions.map((version) => `v${version.version} ${version.digest.slice(0, 12)}`).join(", ");
      console.log(`  ${hunt.huntId}: current v${hunt.currentVersion}, available=${hunt.available} (${versions})`);
    }
    return 0;
  }
  if (command === "new-qr-token") {
    const token = randomBytes(32).toString("base64url");
    console.log("New 256-bit QR token. Treat it as a secret for real hunts; keep it out of public repositories.");
    console.log(`  finale.qrToken : ${token}`);
    console.log(`  QR payload     : ${formatQrPayload(token)}`);
    return 0;
  }
  console.error("Usage: cli validate <content-directory> | cli new-qr-token");
  return 2;
}

process.exitCode = main(process.argv.slice(2));
