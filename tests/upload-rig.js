// tests/upload.sh's server: the server mod's update upload (DLZMOD_updateUpload, #114) on a real
// medium, loaded as server.js has it (appended, its functions global), with the mixer not recording.
// Usage (the dump's node): node upload-rig.js <dlzmod-server.js> <medium mount point> <state folder> <port>
const fs = require("fs");
const http = require("http");
const vm = require("vm");
const [src, root, state, port] = process.argv.slice(2);
const ctx = vm.createContext({ require, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, console });
vm.runInContext(fs.readFileSync(src, "utf8"), ctx);
ctx.getDataKey = () => undefined;
const upload = ctx.DLZMOD_updateUpload(() => root, state);
http.createServer((req, res) => {
  req.path = req.url.split("?")[0];
  upload(req, res, () => {
    res.writeHead(404);
    res.end();
  });
}).listen(Number(port), "127.0.0.1", () => console.log("listening"));
