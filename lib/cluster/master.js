var cluster = require("cluster");
var util = require("util");
var events = require("events");
var os = require("os");
var _ = require("lodash");
var Q = require("q");
var worker = require("./worker");
var fs = require("fs");
var path = require("path");
var usage = require("usage");

function Master(napp) {
    this.napp = napp;
	this.config = _.defaults(_.clone(napp.config), Master.defaults);
	cluster.setupMaster(this.config);

	this.initEvents();
	this.workers = {};
	this.workerCount = 0;
	this.deathCount = 0;
	this.killCount = 0;
	this.onlineCount = 0;

	this.reloading = null;
	this._reloading = null;
	this.reloaded = {};

	this.shuttingdown = false;
	this.hasStarted = false;

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
		cluster.on("listening", function(){
			self.onlineCount++;
			if (!self.hasStarted && self.onlineCount >= self.config.instances) {
				self.hasStarted = true;
				self.status = "ONLINE";
				self.emit("online");
			}
		});

		cluster.on("exit", function(w){

			if (!self.hasStarted && !self.shuttingdown) {
				self.shutdown();
				return;
			}

			self.deathCount++;
			self.onlineCount--;
			delete self.workers[w.id];
			self.workerCount--;
			self.fork();
			self._reload();
			if (self.shuttingdown && self.workerCount === 0) {
				console.log("-- Workers Exited --");
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
		console.log("-- Shutting Down --");
		this.status = "STOPPING";
		this._shuttingdown = Q.defer();
		this.shuttingdown = this._shuttingdown.promise;

		this.killAll(signal);
		this.emit("shutdown");

		return this.shuttingdown;
	},
	reload: function(options) {
		//always reset
		this.reloaded = {};

		if (!this.reloading) {
			//if we are not reloading, create defereds and kick of _reload
			this.reloading = Q.defer();
			this._reload(options);
		}

		return this.reloading.promise;
	},
	_reload: function(options) {
        options = options || {};
		//if we are not reloading, we can jump out
		if (!this.reloading || this.shuttingdown) return;

		var self = this;
		var stillReloading = false;

        _.each(this.workers, function(w, id) {
            if (!self.reloaded[id]) {

                self.replaceWorker(id);
                stillReloading = true;

                if (!options.instant) {
                    console.log("rf")
                    return false;
                } else {
                    console.log("asdf");
                }
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
    getStatus: function() {
        var self = this;
        var workers = Q.all(_.map(this.workers, function(worker){
            return worker.getStatus();
        }));
        var usageData = Q.nfcall(usage.lookup.bind(usage), process.pid, {keepHistory: true});
        return Q.all([workers, usageData])
        .spread(function(workers, usageData){
            return {
                status: self.status,
                uptime: process.uptime(),
                pid: process.pid,
                workers: _.indexBy(workers, "id"),
                deathCount: self.deathCount,
                killCount: self.killCount,
                cpu: usageData.cpu,
                mem: usageData.memory
            };
        });
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