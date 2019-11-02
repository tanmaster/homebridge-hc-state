const getHCDevice = require('./hc-device');

function setup(homebridge) {
  const HCDevice = getHCDevice(homebridge.hap);

  homebridge.registerAccessory('homebridge-hc-state', 'HCDevice', HCDevice);
}

module.exports = setup;
