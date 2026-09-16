import { createApiServer, createStore, loadConfig } from '../server.js';

const config = loadConfig();
const app = createApiServer({
  config,
  store: createStore({ file: config.storeFile }),
});

export default app;
