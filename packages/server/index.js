require('dotenv').config();
const ServerApp = require('./src/ServerApp');

const port = process.env.PORT || 4000;
const app = new ServerApp(port);
app.start();
