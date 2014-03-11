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

var napp = Napp.load(myname);

// setup
var app = express();
app.use(express.jsonParser());
var server = http.createServer(app);
napp.load();
console.log(napp)
var self = new master.Master(napp.config);

// services
app.get("/", function(req,res){
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
	self.shutdown();
	res.send(202);
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
// server.listen(path.join(napp.dirname, "socket"));
server.listen(2000);

//start workers
self.fork();

self.on("shutdown", function(){
	server.close();
});
