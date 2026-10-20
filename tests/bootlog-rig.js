// tests/bootlog-copy.sh's server: the server mod's boot log copy (DLZMOD_bootlogCopy, #136) on a real
// medium, loaded as server.js has it (appended, its functions global), with the mixer not recording
// and up for 150 s; looks every 200 ms.
// Usage (the dump's node): node bootlog-rig.js <dlzmod-server.js> <medium mount point> <boot log file> <uptime file>
const fs = require("fs");
const vm = require("vm");
const [src, root, file, uptime] = process.argv.slice(2);
const ctx = vm.createContext({ require, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, console });
vm.runInContext(fs.readFileSync(src, "utf8"), ctx);
ctx.getDataKey = () => undefined;
ctx.DLZMOD_bootlogCopy(() => root, file, "/proc/mounts", 200, uptime);
console.log("running");
