var cluster = require("cluster");
var mkdirp = require("mkdirp");
var http = require("http");
var express = require("express");
var Q = require("q");
var Napp = require("../napp");
var master = require("./master");
var path = require("path");
var fs = require("fs");

var myname = process.argv[2];
if (!myname) throw new Error("started cluster without a name!");

process.title = "[napps App] " + myname;

var napp = Napp.load(myname);

// setup
var app = express();
app.use(express.json());
var server = http.createServer(app);
napp.load();
var self = new master.Master(napp);

// services
app.get("/status", function(req,res){
	res.type("json");
	res.json(self);
});
app.post("/reload", function(req, res) {
	self.reload()
	.then(res.send.bind(res, 202))
	.catch(res.send.bind(res, 500))
	.done();
});
app.post("/stop", function(req, res) {
	self.shutdown(req.query.force ? null : "SIGINT");
	res.send(202);
});


app.get("/log", function(req, res){
    handleLog("log", res);
});
app.get("/log/:id", function(req, res){
    handleLog("log-" + req.params.id, res);
});


app.post("/workers/:id", function(req, res){
	var id = req.params.id;
	if (self.workers[id]) {
		self.workers[id].send(req.body);
		res.send(202);
	} else {
		res.type("text");
		res.send(404, "no worker with that id");
	}
});
app.post("/workers.all", function(req, res){
	self.send(req.body);
	res.send(202);
});




//bind socket
server.listen(path.join(napp.dirname, "socket"));

//start workers
self.fork();

self.on("shutdown", function(){
	server.close();
});



function handleLog(eventName, res) {
    res.type("text/eventstream");
    var handler = sendmessage.bind(null, res);
    self.on(eventName, handler);
    res.on("finish", function(){
        self.removeListener(eventName, handler);
    });
    res.on("error", function(){
        self.removeListener(eventName, handler);
    });
}

function sendmessage(res, message) {
    res.write("data: " + JSON.stringify(message) + "\n\n");
}

