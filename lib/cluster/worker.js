var events = require("events");
var util = require("util");
var fs = require("fs");
var path = require("path");
var _ = require("lodash");
var moment = require("moment");

function Worker(napp, w){
	this.w = w;
	this.listening = [];
	this.w.on("listening", this.onListen.bind(this));
	this.napp = napp;

	this.setupLogs();
}

Worker.prototype = {

    setupLogs: function() {
        var self = this;

        self.w.process.stdout.on("data",
            self._logHandler.bind(self));
        
        self.w.process.stderr.on("data",
            self._logHandler.bind(self));

    },
    _logHandler: function(message) {
    	var header = moment().format("MMM DD HH:mm:ss") + " " + this.napp.id + "[" + this.w.id + "]: ";
        message = header + message.toString().replace(/^/mg, header).slice(header.length, -header.length);
        if (message[message.length-1] !== "\n") message += "\n";

        this.emit("log", message);
    },
	disconnect: function() {
		if (!this.w.process.connected) return;
		return this.w.disconnect.apply(this.w, arguments);
	},
	kill: function() {
		return this.w.kill.apply(this.w, arguments);
	},
	onListen: function(addr) {
		this.listening.push(addr);
	},
	toJSON: function(){
		return {
			id: this.w.id,
			pid: this.w.process.pid,
			state: this.w.state,
			listening: this.listening
		}
	}
};
_.extend(Worker.prototype, events.EventEmitter.prototype);
exports.Worker = Worker;