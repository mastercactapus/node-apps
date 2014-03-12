var events = require("events");
var util = require("util");
var fs = require("fs");
var path = require("path");
var _ = require("lodash");

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
            this._logHandler.bind(this, "out"));
        
        self.w.process.stderr.on("data",
            this._logHandler.bind(this, "err"));

    },
    _pad: function(len){
    	var buf = new Buffer(len);
    	buf.fill(" ");
    	return buf.toString();
    },
    _logHandler: function(type, message) {
    	var header = "[" + this.napp.id + "-" + this.w.id + " " + "(" + type + ") " + (new Date().toISOString()) + "] ";
    	var pad = this._pad(header.length);

        message = header + message.toString().replace(/^/mg, pad).slice(pad.length, -pad.length);
        if (message[message.length-1] !== "\n") message += "\n";

        this.emit("log-" + type, message);
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