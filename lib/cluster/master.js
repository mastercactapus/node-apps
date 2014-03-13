var cluster = require("cluster");
var util = require("util");
var events = require("events");
var os = require("os");
var _ = require("lodash");
var Q = require("q");
var worker = require("./worker");
var fs = require("fs");
var path = require("path");

function Master(napp) {
    this.napp = napp;
	this.config = _.defaults(_.clone(napp.config), Master.defaults);
	cluster.setupMaster(this.config);

	this.initEvents();
	this.workers = {};
	this.workerCount = 0;
	this.deathCount = 0;
	this.killCount = 0;

	this.reloading = null;
	this._reloading = null;
	this.reloaded = {};

	this.shuttingdown = false;

	this.log = fs.createWriteStream(path.join(this.napp.dirname, "master.log"), {flags: "a"});

	this.status = "STARTING";
}

Master.defaults = {
	instances: os.cpus().length,
	reloadSignal: "SIGINT",
	reloadTimeout: 0,
	silent: true
};

Master.prototype = {
	initEvents: function(){
		var self = this;

		cluster.on("fork", function(w){
			self.reloaded[w.id] = true;
			self.workerCount++;
			self.workers[w.id] = new worker.Worker(self.napp, w);
			self.workers[w.id].on("log", self._handleLog.bind(self, w.id));
		});
		cluster.on("online", function(){
			if (self.status === "STARTING") {
				self.status = "ONLINE";
			}
		});

		cluster.on("exit", function(w){
			self.deathCount++;
			delete self.workers[w.id];
			self.workerCount--;
			self.fork();
			self._reload();
			if (self.shuttingdown && self.workerCount === 0) {
				self._shuttingdown.resolve();
			}
		});

		process.on("SIGINT", function(){
			self.shutdown("SIGINT");
		});

		process.on("SIGTERM", function(){
			self.shutdown();
		});
	},
	_handleLog: function(workerId, message) {
		this.log.write(message);
	    this.emit("log-" + workerId, message);
	    this.emit("log", message);
	},
	shutdown: function(signal) {
		if (this.shuttingdown) return this.shuttingdown;
		this.status = "STOPPING";
		this._shuttingdown = Q.defer();
		this.shuttingdown = this._shuttingdown.promise;

		this.killAll(signal);
		this.emit("shutdown");

		return this.shuttingdown;
	},
	reload: function() {
		//always reset
		this.reloaded = {};

		if (!this.reloading) {
			//if we are not reloading, create defereds and kick of _reload
			this.reloading = Q.defer();
			this._reload();
		}

		return this.reloading.promise;
	},
	_reload: function() {
		//if we are not reloading, we can jump out
		if (!this.reloading || this.shuttingdown) return;

		var self = this;
		var stillReloading = false;
		_.each(this.workers, function(w, id) {
			if (!self.reloaded[id]) {

				self.replaceWorker(id);
				stillReloading = true;

				return false;
			}
		});

		if (!stillReloading) {
			//didn't find any more stale workers
			this.reloading.resolve();
			this.reloading = null;
		}
	},
	replaceWorker: function(id) {
		var self = this;
		// to replace a worker, fork a new one
		// and send the reload signal to the old one
		// the exit handler will take care of looping this
		cluster.fork(this.config.env);
		this.workers[id].kill(this.config.reloadSignal);
		self.killCount++;
	},

	killAll: function(signal) {
		var self = this;
		_.each(_.clone(this.workers), function(worker){
		    if (signal) {
		        process.kill(worker.w.process.pid, signal);
		        self.killCount++;
		    } else {
		        worker.kill();
		    }
		});
	},
	toJSON: function(){
		return {
			status: this.status,
			uptime: process.uptime(),
			memoryUsage: process.memoryUsage(),
			pid: process.pid,
			workers: this.workers,
			deathCount: this.deathCount,
			killCount: this.killCount
		};
	},
	fork: function(){
		if (this.shuttingdown) return;
		var toSpawn = this.config.instances - this.workerCount;
		for (var i=0;i<toSpawn;i++) {
			cluster.fork(this.config.env);
		}
	}
};
_.extend(Master.prototype, events.EventEmitter.prototype);

exports.Master = Master;