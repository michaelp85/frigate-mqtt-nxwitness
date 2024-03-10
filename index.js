const mqtt = require('mqtt');
const axios = require('axios').default; // Ensure axios is correctly imported
const { v4: uuidv4 } = require('uuid');
const https = require('https'); // Require HTTPS module for secure requests

// Load configuration
var config = require('/config/config.json');

// Create a reusable HTTPS agent with your required configurations for SSL
// If you need to bypass self-signed certificates, uncomment the rejectUnauthorized line. Use with caution.
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Uncommented for testing, comment if using signed certificates (recommended for production)
});

// Setup MQTT connection
var client  = mqtt.connect('mqtt://' + config.mqtt.host);
client.on('connect', function () {
    client.subscribe(config.mqtt.topic + '/#', function (err) {
        if (err) {
            console.error('Subscription error:', err);
            return;
        }
        console.log('Subscribed to MQTT topic: ' + config.mqtt.topic);
    });
});

// Function to set token
async function setToken() {
    try {
        const authPayload = {
            username: config.nxwitness.username,
            password: config.nxwitness.password,
            // setCookie: false, // Adjust according to your API's needs
        };
        const response = await axios.post(`https://${config.nxwitness.host}:${config.nxwitness.port}/rest/v1/login/sessions`, authPayload, {
            headers: { Accept: "application/json" },
            responseType: 'json',
            httpsAgent, // Use the HTTPS agent for secure requests
        });
        const token = response.data.token;
        return `Bearer ${token}`;
    } catch (error) {
        console.error('Error getting token:', error);
        throw new Error('Failed to authenticate and get token');
    }
}

// On receive MQTT message
client.on('message', async function (topic, message) {
    try {
        var topicPath = topic.split('/');

        if (topicPath[1] !== 'available') { // Updated comparison to strict inequality
            var camera = topicPath[1];
            var mappedCamera = config.cameraMap.find(i => i.frigateName === camera); // Updated comparison to strict equality

            if (mappedCamera && topicPath[2] === 'events' && topicPath[3] === 'end') { // Simplified conditional checks
                var eventData = JSON.parse(message.toString());

                if (!eventData.false_positive) {
                    var event = {
                        guid: uuidv4(),
                        cameraId: mappedCamera.nxwId,
                        name: eventData.label,
                        startTimeMs: Math.round(eventData.start_time * 1000),
                        durationMs: Math.round((eventData.end_time - eventData.start_time) * 1000),
                        tag: 'frigate'
                    };

                    // Get bearer token
                    const bearerToken = await setToken();

                    // Send data to NX Witness with bearer token over HTTPS
                    axios.request({
                        method: 'GET', // Ensure this matches the required method
                        url: `https://${config.nxwitness.host}:${config.nxwitness.port}/ec2/bookmarks/add`,
                        headers: {
                            Authorization: bearerToken,
                            Accept: "application/json"
                        },
                        responseType: 'json',
                        params: event,
                        httpsAgent, // Use the HTTPS agent
                    })
                    .then(function (response) {
                        console.log(`Notified NX Witness of "${event.name}" event on "${camera}"`);
                    })
                    .catch(function (error) {
                        console.log('Something went wrong trying to notify NX Witness:');
                        console.log(error);
                    });
                } else {
                    console.log(`Skipping false positive event from: ${camera}`);
                }
            } else {
                console.log(`Received event from unconfigured camera: ${camera}`);
            }
        }
    } catch (e) {
        console.log('Something went wrong processing the MQTT message:');
        console.log(e);
    }
});
