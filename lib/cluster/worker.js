var events = require("events");
var util = require("util");
var fs = require("fs");
var path = require("path");
var _ = require("lodash");

function Worker(napp, w){
	this.w = w;
	this.listening = [];
	this.w.on("listening", this.onListen.bind(this));
	this.w.on("exit", this.cleanupLogs.bind(this));
	this.napp = napp;

	this.outlogpath = path.join(napp.dirname, "worker-" + this.w.id + ".out.log");
	this.errlogpath = path.join(napp.dirname, "worker-" + this.w.id + ".err.log");
	
	this.setupLogs();
}

Worker.prototype = {
    cleanupLogs: function() {
        this.outlog.close();
        this.errlog.close();
    },
    setupLogs: function() {
        var self = this;

        self.outlog = fs.createWriteStream(self.outlogpath, {flags: "a"});
        self.errlog = fs.createWriteStream(self.errlogpath, {flags: "a"});

        self.w.process.stdout.on("data",
            this._logHandler.bind(this, this.outlog, "out"));
        
        self.w.process.stderr.on("data",
            this._logHandler.bind(this, this.errlog, "err"));

    },
    _logHandler: function(outputStream, type, message) {
        message = "[" + (new Date().toISOString()) + "] " + message.toString();
        if (message[message.length-1] !== "\n") message += "\n";
        outputStream.write(message);
        this.emit("log", {
            type: type,
            message: message
        });
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