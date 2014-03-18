var _ = require("lodash");
var events = require("events");

//A simple class to broadcast log messages with a short history

function LogRing(maxEntries) {
    this.maxEntries = maxEntries || 32;
    this.entries = [];
    _.bindAll(this);
}

LogRing.prototype = {
    log: function(message) {
        this.entries.push(message);
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
        this.emit("log", message);
    },
    
    //subscribes to logs, replaying the backlog first
    attach: function(fn) {
        _.each(this.entries, fn);
        this.on("log", fn);
        return fn;
    },
    
    detach: function(fn) {
        this.removeListener("log", fn);
    },
    
    detachAll: function() {
        this.removeAllListeners();
    }
};

_.extend(LogRing.prototype, events.EventEmitter.prototype);

module.exports = LogRing;
