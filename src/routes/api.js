import { Router } from "express";
import INITIAL_FRONTEND_DATA from "../../Data/cache_data.json";
import INITIAL_SOLAR_CAR_DATA from "../../Data/dynamic_data.json";
import DATA_FORMAT from "../../Data/sc1-data-format/format.json";
import CONSTANTS from "../../constants.json";
import net from "net";
import fetch from 'node-fetch';

const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

readline.setPrompt('Enter \'r\' to refresh the table that\'s being queried: ');

const ROUTER = Router();
let solarCarData = INITIAL_SOLAR_CAR_DATA;
let frontendData = INITIAL_FRONTEND_DATA;

const NUM_BYTES_IDX = 0;
const DATA_TYPE_IDX = 1;
// The max number of data points to have in each array at one time
// equivalent to 10 minutes' worth of data being sent 30 Hz
const X_AXIS_CAP = CONSTANTS.X_AXIS_CAP;


let bytesPerPacket = 0;
for (const property in DATA_FORMAT) {
  bytesPerPacket += DATA_FORMAT[property][NUM_BYTES_IDX];
}

// Send data to front-end
ROUTER.get("/api", (req, res) => {
  //console.time("send http");
  const temp = res.send({ response: frontendData }).status(200);
  //temp.addListener("finish", () => console.timeEnd("send http"));
});


const clients = [];

const server = net.createServer((socket) => {
  readline.pause();
  console.log('\nClient connected');
  readline.prompt(true);

  clients.push(socket);

  function exit() {
    const index = clients.indexOf(socket);

    if (index > -1) {
      clients.splice(index, 1);
      console.log("Client removed from list");
    } else {
      console.log("Client has already been removed");
    }

    if(!socket.destroyed) {
      socket.destroy();
      console.log("Socket successfully destroyed");
    } else {
      console.log("Socket has already been destroyed");
    }
  }

  // Error, connection closed, and connection ended listeners
  socket.on("error", (error) => {
    readline.pause();
    console.warn("\nSocket errored", error);
    exit();
    readline.prompt(true);
  });

  socket.on("close", (close) => {
    readline.pause();
    console.warn("\nSocket closed", close);
    exit();
    readline.prompt(true);
  });

  socket.on("end", () => {
    readline.pause();
    console.warn("\nClient disconnected (socket ended)");
    exit();
    readline.prompt(true);
  });
});

server.on('error', (err) => {
  console.error(`Server error: ${err}`);
});

server.listen(4003, () => {
  console.log('Server listening on port 4003');
});

function broadcastData(data) {
  //console.log("Broadcasting data")
  clients.forEach((client) => {
    if (!client.destroyed) {
      // TODO console.log("writing data");
      client.write(data);
    }
  });
}



//----------------------------------------------------- LTE ----------------------------------------------------------
let interval;
let tableName;
let latestTimestamp;
// Counts for the total number of fetches and successes
let fetchCount = 0;
let successCount = 0;

const MILLIS_PER_MIN = 60000;


async function getLatestTable() {
  console.log("Retrieving the most recent table...");
  // Get most recently created table that has a timestamp for a name
  await fetch(`http://150.136.104.125:3000/newest-timestamp-table`, {
    method: 'GET',
    headers: {
      "Content-type": "application/json"
    }
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      tableName = data.response;
      console.log(`Got table name: ${tableName}`);
    });
}


function promptRefresh() {
  readline.question(readline.getPrompt(), (input) => {
    if(input === 'r') {
      getLatestTable().then(() => {
        promptRefresh();
      });
    } else {
      promptRefresh();
    }
  });
}


async function setupVPSInterface() {
  await getLatestTable();
  promptRefresh();

  // Get the first timestamp from the table and subtract 1 so that it is included
  // in the first group of retrieved entries
  await fetch(`http://150.136.104.125:3000/get-first-timestamp/${tableName}`, {
    method: 'GET',
    headers: {
      "Content-type": "application/json"
    }
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      // Get the first timestamp in the table (minus 1)
      latestTimestamp = data.response - 1;
      // Get millisecond timestamp from ten minutes ago
      const tenMinutesEarlier = Date.now() - 10 * MILLIS_PER_MIN;

      // Set latestTimestamp to whichever is later: ten minutes ago or the first timestamp in the table (minus 1)
      latestTimestamp = (latestTimestamp >= tenMinutesEarlier) ? latestTimestamp : tenMinutesEarlier;
      //console.log(`Got latest timestamp: ${latestTimestamp}`);
    });

  // Fetch the newest rows at regular intervals
  interval = setInterval(() => {
    //console.log(`Fetching http://150.136.104.125:3000/get-new-rows/${tableName}/${latestTimestamp}`);

    // Increment the total number of fetches
    fetchCount ++;

    //console.log("Fetch:",fetchCount,"\tSuccess:",successCount);

    if(fetchCount === (successCount + 1)) {
      fetch(`http://150.136.104.125:3000/get-new-rows/${tableName}/${latestTimestamp}`, {
        method: 'GET',
        headers: {
          "Content-type": "application/json"
        }
      })
        .then(function(response) {
          return response.json();
        })
        .then(function(data) {
          //console.log("Getting new rows", data);

          // Get the rows of timestamps and data from the response
          let rows = data.response;

          // Make sure there was at least 1 row returned
          if(data.response.length > 0) {
            // Iterate through the rows and print the timestamps and payloads
            //                          and unpack the payloads
            let i;
            for(i in rows) {
              //console.log('\ttimestamp:', rows[i].timestamp, '\nBytes:', Buffer.from(rows[i].payload.data));
              broadcastData(Buffer.from(rows[i].payload.data));
              unpackData(Buffer.from(rows[i].payload.data)); // TODO
            }

            // Update the latest timestamp
            latestTimestamp = rows[i].timestamp;
          }

          // Increment total number of successes
          successCount ++;
          // Reset fetchCount to match successCount so that on the next iteration, the get-new-rows will be fetched
          fetchCount = successCount;

          // TODO Gets the first item of the response
          // console.log('Request succeeded with JSON response', data);
          // console.log('Count:', data.count, '\ttimestamp:', data.tStamp, '\nBytes:', Buffer.from(data.bytes.data));
        })
        .catch(function(error) {
          //console.log('Request failed', error);
		  fetchCount = successCount;
        });
    }
  }, 250);
}

setupVPSInterface();



//----------------------------------------------------- TCP ----------------------------------------------------------
const CAR_PORT = CONSTANTS.CAR_PORT; // Port for TCP connection
let CAR_ADDRESS; // TCP server's IP address (PI_ADDRESS to connect to pi; TEST_ADDRESS to connect to data generator)

// Set CAR_ADDRESS according to the command used to start the backend
if((process.argv.length === 3) && (process.argv.findIndex((val) => val === "dev") === 2)) {
  // `npm start dev` was used. Connect to data generator
  CAR_ADDRESS = CONSTANTS.TEST_ADDRESS;
} else if(process.argv.length === 2) {
  // `npm start` was used. Connect to the pi
  CAR_ADDRESS = CONSTANTS.PI_ADDRESS;
} else {
  // An invalid command was used. Throw an error describing the usage
  throw new Error('Invalid command. Correct usages:\n' +
      '\t`npm start`: Use to connect the backend to the pi\n' +
      '\t`npm run start-dev`: Use to connect the backend to the local data generator\n' +
      '\t`npm start dev` (from Backend/ only): Same as `npm run start-dev`\n');
}


/**
 * Creates a connection with the TCP server at port CAR_PORT and address CAR_ADDRESS. Then, sets listeners for connect,
 * data, close, and error events. In the event of an error, the client will attempt to re-open the socket at
 * regular intervals.
 */
function openSocket() {
  readline.pause();
  // Establish connection with server
  var client = net.connect(CAR_PORT, CAR_ADDRESS); // TODO Add third parameter (timeout in ms) if we want to timeout due to inactivity
  client.setKeepAlive(true);
  readline.prompt(true);

  // Connection established listener
  client.on("connect", () => {
    readline.pause();
    console.log(`\nConnected to car server: ${client.remoteAddress}:${CAR_PORT}`);
    readline.prompt(true);
  });

  // Data received listener
  client.on("data", (data) => {
    if(data.length === bytesPerPacket) {
      //console.time("update data");
      broadcastData(data);
      unpackData(data);
      //console.timeEnd("update data");
    } else {
      readline.pause();
      console.warn("\nERROR: Bad packet length ------------------------------------");
      readline.prompt(true);
    }
  });

  // Socket closed listener
  client.on("close", function () {
    // Pull the most recent solar_car_connection values to false if connection was previously established
    if (solarCarData.solar_car_connection.length > 0) {
      solarCarData.solar_car_connection[0] = false;
      frontendData.solar_car_connection[0] = false;
    }

    readline.pause();
    console.log(`\nConnection to car server (${CAR_PORT}) is closed`);
    readline.prompt(true);
  });

  // Socket error listener
  client.on("error", (err) => {
    readline.pause();
    // Log error
    console.log("\nClient errored out:", err);

    // Kill socket
    client.destroy();
    client.unref();

    // Pull the most recent solar_car_connection values to false if connection was previously established
    if (solarCarData.solar_car_connection.length > 0) {
      solarCarData.solar_car_connection[0] = false;
      frontendData.solar_car_connection[0] = false;
    }

    // Attempt to re-open socket
    setTimeout(openSocket, 1000);
  });
}


/**
 * Unpacks a Buffer and updates the data to be passed to the front-end
 *
 * @param data the data to be unpacked
 */
function unpackData(data) {
  let buffOffset = 0; // Byte offset for the buffer array
  let timestamps = solarCarData["timestamps"]; // The array of timestamps for each set of data added to solarCarData
  // Array values indicate the status of the connection to the solar car. These will always be true when unpacking data
  let solar_car_connection = solarCarData["solar_car_connection"];

  // Add separators for timestamp to timestamps and limit array's length
  timestamps.unshift("::.");
  if (timestamps.length > X_AXIS_CAP) {
    timestamps.pop();
  }

  // Repeat with solar_car_connection
  solar_car_connection.unshift(true);
  if (solar_car_connection.length > X_AXIS_CAP) solar_car_connection.pop();
  solarCarData["solar_car_connection"] = solar_car_connection;

  for (const property in DATA_FORMAT) {
    let dataArray = []; // Holds the array of data specified by property that will be put in solarCarData
    let dataType = ""; // Data type specified in the data format

    if (solarCarData.hasOwnProperty(property)) {
      dataArray = solarCarData[property];
    }
    dataType = DATA_FORMAT[property][DATA_TYPE_IDX];

    // Add the data from the buffer to solarCarData
    switch (dataType) {
      case "float":
        // Add the data to the front of dataArray
        dataArray.unshift(data.readFloatLE(buffOffset));
        break;
      case "char":
        // Add char to the front of dataArray
        dataArray.unshift(String.fromCharCode(data.readUInt8(buffOffset)));
        break;
      case "bool":
        // Add bool to the front of dataArray
        dataArray.unshift(Boolean(data.readUInt8(buffOffset)));
        break;
      case "uint8":
        switch (property) {
          case "tstamp_hr":
            const hours = data.readUInt8(buffOffset);
            if (hours < 10) timestamps[0] = "0" + hours + timestamps[0];
            else timestamps[0] = hours + timestamps[0];
            break;
          case "tstamp_mn":
            const mins = data.readUInt8(buffOffset);
            timestamps[0] = timestamps[0].replace(
                "::",
                ":" + (mins < 10 ? "0" + mins : mins) + ":"
            );
            break;
          case "tstamp_sc":
            const secs = data.readUInt8(buffOffset);
            timestamps[0] = timestamps[0].replace(
                ":.",
                ":" + (secs < 10 ? "0" + secs : secs) + "."
            );
            break;
          default:
            // Add the data to the front of dataArray
            dataArray.unshift(data.readUInt8(buffOffset));
            break;
        }
        break;
      case "uint16":
        if (property === "tstamp_ms") {
          const millis = data.readUInt16BE(buffOffset);
          let millisStr;
          if (millis >= 100) {
            millisStr = millis;
          } else if (millis >= 10) {
            millisStr = "0" + millis;
          } else {
            millisStr = "00" + millis;
          }
          if (typeof millisStr === "undefined") {
            console.warn(
                `Millis value of ${millis} caused undefined millis value`
            );
          }

          timestamps[0] += millisStr;
          break;
        }
        // Add the data to the front of dataArray
        dataArray.unshift(data.readUInt16BE(buffOffset));
        break;
      default:
        // Log if an unexpected type is specified in the data format
        console.log(
            `No case for unpacking type ${dataType} (type specified for ${property} in format.json)`
        );
        break;
    }

    if (!property.startsWith("tstamp")) {
      // If property is not used for timestamps
      // Limit dataArray to a length specified by X_AXIS_CAP
      if (dataArray.length > X_AXIS_CAP) {
        dataArray.pop();
      }
      // Write dataArray to solarCarData at the correct key
      solarCarData[property] = dataArray;
    }

    // Increment offset by amount specified in data format
    buffOffset += DATA_FORMAT[property][NUM_BYTES_IDX];
  }

  // Update the timestamps array in solarCarData
  solarCarData["timestamps"] = timestamps;

  // Update the data to be passed to the front-end
  frontendData = solarCarData;
}

// Create new socket
openSocket();

export default ROUTER;
