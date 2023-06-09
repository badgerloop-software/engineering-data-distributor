import express from "express";
import { createServer } from "http";
import index from "./routes/api.js";
import CONSTANTS from "../constants.json";

const PORT = CONSTANTS.SERVER_PORT;
const APP = express();
APP.use(index);

const SERVER = createServer(APP);

SERVER.listen(PORT, () => console.log(`Listening on port ${PORT}`));
