import { createApp } from "./app";
const port = Number(process.env.API_PORT || 4000);
createApp().listen(port, "127.0.0.1", () =>
  console.log(`FOP API listening on http://127.0.0.1:${port}`),
);
