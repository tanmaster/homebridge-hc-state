/**
 * heavily inspired by homebridge-wol
 * and https://gist.github.com/oznu/0c32d10473c1c26e6e2aa57809b81895
 *
 * */

const fs = require('fs');
const request = require('request');
const stream = require('stream');


const Status = {
    Running: Symbol('Running'),
    Inactive: Symbol('Inactive'),
    Disconnected: Symbol("Disconnected"),
    WakingUp: Symbol('Waking Up'),
    ShuttingDown: Symbol('Shutting Down')
};


let Service;
let Characteristic;


function getHCDevice(API) {
    Service = API.Service;
    Characteristic = API.Characteristic;
    return HCDevice;
}

function getValueOfSymbol(symbol) {
    return String(symbol).replace(/Symbol\(|\)/gi, '');
}

class Filter extends stream.Transform {

    _transform(chunk, encoding, callback) {
        if (String(chunk).includes("event:STATUS")) {
            this.push(chunk);
        }
        callback();
    }
}

class HCDevice {
    constructor(log, config) {
        this.config = Object.assign({
            name: 'My Home-Connect Device',
            tokenPath: null,
            haId: null,
        }, config);
        this.log = log;

        if (this.config.haId == null || this.config.tokenPath == null) {
            throw new Error("Missing one or more required parameters.");
        }

        this.status = Status.Inactive;
        // Read token file
        this.token = JSON.parse(fs.readFileSync(this.config.tokenPath));

        // Set up a homebridge service - a switch
        this.service = new Service.Switch(this.config.name);

        this.refreshToken();

        // Run event stream processing every 12 with a new token
        setInterval(this.processEvents.bind(this), 1000 * 60 * 60 * 12);

        // Refresh token every 12 hours starting from now
        setInterval(this.refreshToken.bind(this), 1000 * 60 * 60 * 12);

    }

    processEvents() {
        // query current status and set it
        this.refreshCurrentStatus();

        let options = {
            method: "GET",
            headers: {
                "accept": "text/event-stream",
                "Accept-Language": "en-US",
                "authorization": "Bearer " + this.token.access_token
            }
        };
        let self = this;
        request("https://api.home-connect.com/api/homeappliances/" + this.config.haId + "/events", options)
            .on('response', (response) => {
                this.log("Start listening to stream...")
            }).pipe(new Filter())
            .on("data", (data) => {
                if (data.toString().includes("event:NOTIFY") && data.toString().includes("BSH.Common.EnumType.PowerState.On")) {
                    self.log("Stream processed new state: Turning ON");
                    self.setStatus(Status.WakingUp);
                } else if (data.toString().includes("event:NOTIFY") && data.toString().includes("BSH.Common.EnumType.PowerState.Standby")) {
                    self.log("Stream processed new state: OFF");
                    self.setStatus(Status.ShuttingDown);
                    self.log('Waiting for 10 before changing state to Inactive!');
                    setTimeout(function () {
                        self.setStatus(Status.Inactive);
                    }, 10000);
                } else if (data.toString().includes("BSH.Common.EnumType.OperationState.Ready")) {
                    self.log("Stream processed new state: READY!");
                    self.setStatus(Status.Running);
                }
            });
    }

    setStatus(newStatus) {
        // Debouncing - only react to a change if it has actually changed
        if (newStatus !== this.status) {
            this.log('HCDevice "%s" went from status "%s" to "%s"', this.config.name
                , getValueOfSymbol(this.status), getValueOfSymbol(newStatus));
            this.status = newStatus;

            // Trigger change in homebridge
            this.service.getCharacteristic(Characteristic.On).getValue();
        }
    }

    /**
     * Queries the current state from the API. DO NOT USE THIS ITERATIVELY, API CALLS ARE LIMITED.
     * Only used at init time to get current state of device. For subsequent information about state
     * use processEvents function.
     * */
    refreshCurrentStatus() {
        if (this.token.timestamp + this.token.expires_in < (new Date()).getTime() / 1000) {
            this.refreshToken();
        }
        let options = {
            method: "GET",
            headers: {
                "accept": "application/vnd.bsh.sdk.v1+json",
                "Accept-Language": "en-GB",
                "authorization": "Bearer " + this.token.access_token
            }
        };

        let self = this;
        request("https://api.home-connect.com/api/homeappliances/" + this.config.haId, options,
            (err, res, body) => {
                let result = JSON.parse(body);
                if (!result.data.connected) self.setStatus(Status.Disconnected);
            });


        request("https://api.home-connect.com/api/homeappliances/" + this.config.haId + "/status", options,
            (err, res, body) => {
                let result = JSON.parse(body);
                try {
                    let state = result.data.status[2].displayvalue;
                    if (state === "Inactive") {
                        self.log("Current state is inactive");
                        self.setStatus(Status.Inactive);
                    } else if (state === "Ready") {
                        self.log("Current state is Running");
                        self.setStatus(Status.Running);
                    } else {
                        self.log("Current state is unknown");
                        self.log(body);
                    }
                } catch (e) {
                    this.log("Unexpected response from result: " + result);
                    self.setStatus(Status.Disconnected);
                }
            });
    }

    /**
     * Refreshes token and stores new token in the supplied tokenPath file
     * */
    refreshToken() {
        let options = {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            form: {
                grant_type: "refresh_token", refresh_token: this.token.refresh_token,
                client_secret: this.token.client_secret
            }
        };
        let self = this;
        request("https://api.home-connect.com/security/oauth/token", options, (err, res, body) => {
            if (err) {
                self.log("Could not refresh token..." + err);
            }
            this.log("Token refresh received code: " + res.statusCode + (res.statusCode >= 300 ? ". Returning." : "."));
            if (res.statusCode >= 300) return;
            let new_token = JSON.parse(body);
            this.token.access_token = new_token.access_token;
            this.token.refresh_token = new_token.refresh_token;
            this.token.timestamp = (new Date()).getTime() / 1000;
            this.token.expires_in = new_token.expires_in;
            fs.writeFile(self.config.tokenPath, JSON.stringify(this.token), 'utf8', (err) => {
                if (err) {
                    this.log("An error occured while writing JSON Object to File.");
                    return this.log(err);
                }
                this.log("Token has been refreshed.");
            });
        });
    }


    getServices() {

        const informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Tan Yücel')
            .setCharacteristic(Characteristic.Model, 'HC-State v1')
            .setCharacteristic(Characteristic.SerialNumber, '001');


        this.service.getCharacteristic(Characteristic.On)
            .on('get', this.getOnCharacteristicHandler.bind(this))
            .on('set', this.setOnCharacteristicHandler.bind(this));

        return [informationService, this.service]
    }

    setOnCharacteristicHandler(value, callback) {
        // Don't allow user to change the state when waking up or shutting down
        if (this.status === Status.WakingUp || this.status === Status.ShuttingDown)
            callback(null);

        const isOnline = this.status === Status.Running;
        // Homebridge provides its states as numbers (0 / 1)
        const shouldBeOnline = Boolean(value);
        // no change is necessary if we're currently in the correct state
        if (shouldBeOnline === isOnline) {
            callback(null);
            return;
        }

        if (shouldBeOnline) {
            this.log('HCDevice awake cycle started for "%s"', this.config.name);
            this.switch(true);
        } else {
            this.log('HCDevice shutdown cycle started for "%s"', this.config.name);
            this.switch(false);
        }

        this.log(`calling setOnCharacteristicHandler`, value);
        callback(null);
    }

    getOnCharacteristicHandler(callback) {
        // The following line was commented out because it clogged the log too much imo file.
        // this.log(`calling getOnCharacteristicHandler`, this.status);
        callback(null, (this.status === Status.Running || this.status === Status.WakingUp));
    }

    switch(on) {
        let options = {
            method: "PUT",
            headers: {
                "accept": "application/vnd.bsh.sdk.v1+json",
                "Accept-Language": "en-GB",
                "authorization": "Bearer " + this.token.access_token,
                "Content-Type": "application/vnd.bsh.sdk.v1+json"
            },
            body:
                JSON.stringify({
                    "data": {
                        "key": "BSH.Common.Setting.PowerState",
                        "value": ("BSH.Common.EnumType.PowerState." + (on ? "On" : "Standby")),
                        "type": "BSH.Common.EnumType.PowerState",
                        "constraints": {
                            "allowedvalues": [
                                "BSH.Common.EnumType.PowerState.On",
                                "BSH.Common.EnumType.PowerState.Standby"
                            ]
                        }
                    }
                })
        };
        request("https://api.home-connect.com/api/homeappliances/" + this.config.haId + "/settings/BSH.Common.Setting.PowerState",
            options).on('response', (response) => {
            this.log("HTTP Response Code from API: " + response.statusCode)
        });
    }
}

module.exports = getHCDevice;
