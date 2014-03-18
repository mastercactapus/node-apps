var events = require("events");
var util = require("util");
var fs = require("fs");
var path = require("path");
var _ = require("lodash");
var moment = require("moment");
var Q = require("q");
var psTree = require("ps-tree");
var usage = require("usage");
var LogRing = require("../log-ring");

function Worker(napp, w){
	this.w = w;
	this.listening = [];
	this.w.on("listening", this.onListen.bind(this));
	this.napp = napp;
    this._startTime = Date.now();

    this.logRing = new LogRing();
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

        this.logRing.log(message);
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
    getStatus: function() {
        var self = this;
        
        var children = this.getChildren()
        .then(function(children){
            return Q.all(_.map(children, function(child){
                return Q.nfcall(usage.lookup.bind(usage), child.PID, {keepHistory: true})
                .then(function(usageData){
                    return {
                        pid: child.PID,
                        ppid: child.PPID,
                        cpu: usageData.cpu,
                        mem: usageData.memory
                    };
                });
            }));
        });
        
        var usageData = Q.nfcall(usage.lookup.bind(usage), self.w.process.pid, {keepHistory: true});
        
        return Q.all([children, usageData])
        .spread(function(children, usageData){
            return {
                id: self.w.id,
                pid: self.w.process.pid,
                state: self.w.state,
                listening: self.listening,
                uptime: (Date.now() - self._startTime) / 1000,
                children: children,
                mem: usageData.memory,
                cpu: usageData.cpu
            };
        });
    },
    getChildren: function(){
        return Q.nfcall(psTree, this.w.process.pid);
    }
};
_.extend(Worker.prototype, events.EventEmitter.prototype);
exports.Worker = Worker;