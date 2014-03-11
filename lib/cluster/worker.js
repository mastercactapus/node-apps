var events = require("events");
var util = require("util");

function Worker(w){
	this.w = w;
	this.ports = [];
	this.w.on("listening", this.onListen.bind(this));
};

Worker.prototype = {
	disconnect: function() {
		if (!this.w.process.connected) return;
		return this.w.disconnect.apply(this.w, arguments);
	},
	kill: function() {
		return this.w.kill.apply(this.w, arguments);
	},
	onListen: function(addr) {
		this.ports.push(addr);
	},
	toJSON: function(){
		return {
			id: this.w.id,
			pid: this.w.process.pid,
			state: this.w.state,
			ports: this.ports,
			uptime: this.w.process.uptime()
		}
	}
};

exports.Worker = Worker;