"use strict";
const PREFIX = "[Portrait Perspective]";
module.exports = {
  info(message, details) { console.log(PREFIX, message, details === undefined ? "" : details); },
  error(message, error) { console.error(PREFIX, message, error && error.stack ? error.stack : error); }
};
