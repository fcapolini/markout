// // Example server code
// import http from "http";

// const server = http.createServer((req, res) => {
//   res.writeHead(200, { "Content-Type": "text/plain" });
//   res.end("Hello, World!");
// });

// server.listen(3000, () => {
//   console.log("Server running at <http://localhost:3000/>");
// });

import { BaseContext } from "./runtime/base/base-context";

new BaseContext({ root: { id: '0' } });
