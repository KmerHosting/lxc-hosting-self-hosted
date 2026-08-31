import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const IMAGES = ["images:ubuntu/24.04", "images:ubuntu/22.04", "images:debian/12", "images:alpine/3.20", "images:rockylinux/9", "images:almalinux/9"];

export async function runtime() {
  for (const command of ["incus", "/snap/bin/lxc", "lxc"]) {
    try {
      // `remote list` identifies the Incus/LXD client and avoids mistaking the
      // unrelated legacy Linux Containers client for the hosting runtime.
      await exec(command, ["remote", "list", "--format", "json"], { timeout: 8000 });
      return command;
    } catch (error) {
      if (error.code === "ENOENT") continue;
    }
  }
  return null;
}

async function run(command, args, timeout = 60_000) {
  const { stdout, stderr } = await exec(command, args, { timeout, maxBuffer: 2 * 1024 * 1024 });
  return { stdout, stderr };
}

export async function listContainers(command) {
  if (!command) return [];
  try { return JSON.parse((await run(command, ["list", "--format", "json"])) .stdout); }
  catch { return []; }
}

export async function createContainer(command, { name, image, cpu, memoryMb, storageGb }) {
  if (!IMAGES.includes(image)) throw new Error("That image is not in the supported local catalog.");
  await run(command, ["launch", image, name, "-c", `limits.cpu=${cpu}`, "-c", `limits.memory=${memoryMb}MiB`, "-d", `root,size=${storageGb}GiB`], 120_000);
}
export async function action(command, name, requested) {
  const args = requested === "restart" ? ["restart", name] : requested === "delete" ? ["delete", name, "--force"] : [requested, name];
  await run(command, args, 120_000);
}
export async function snapshot(command, name, snapshotName) { await run(command, ["snapshot", "create", name, snapshotName], 120_000); }
export { IMAGES };
