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

var log = fs.createWriteStream(path.join(napp.dirname, "cluster.log"), {flags: "a",highWaterMark:1});

// process.__defineGetter__('stderr', function(){
// 	return log;
// });
// process.__defineGetter__('stdout', function(){
// 	return log;
// });

// setup
var app = express();
app.use(express.json());
var server = http.createServer(app);
napp.load();
var self = new master.Master(napp);

// services
app.get("/status", function(req,res){
    self.getStatus()
    .then(function(status){
        res.type("json");
        res.json(status);
    })
    .catch(function(err){
        res.type("text");
        res.send(500, err.message||err);
    })
    .done();
});
app.post("/reload", function(req, res) {
	self.reload(req.query)
	.then(res.json.bind(res, 204, null))
	.catch(res.send.bind(res, 500))
	.done();
});
app.post("/stop", function(req, res) {
	self.shutdown(req.query.force ? null : "SIGINT")
	.then(function(){
		res.json(204);
	})
	.done();
});
app.get("/ping", function(req,res){
	res.type("json");
	res.json({pong: true});
});

app.get("/log.cluster", function(req, res){

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
		res.json(202);
	} else {
		res.type("text");
		res.json(404, "no worker with that id");
	}
});
app.post("/workers.broadcast", function(req, res){
	self.send(req.body);
	res.json(202);
});


//bind socket
server.listen(path.join(napp.dirname, "socket"));
server.unref();

self.once("online", function(){
	if (process.send) {
		process.send("online");
	}
});

//start workers
self.fork();

process.on("exit", function(){
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

