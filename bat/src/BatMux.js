"use strict";
var BatStream = require('./BatStream');
var stream_url = require('stream-url');
var util         = require("util");
var EventEmitter = require("events").EventEmitter;

/** The class is mostly useful to test text-based, line-based protocols.
    It multiplexes/demultiplexes several text streams to/from a single
    tagged stream. The tag is normally [tag].
    May also act as a quasi-server, so
        new TestMux('mux1')
        test_stream.connect('test:mux1#tag')
    will lead to every write
        test_stream.write('something')
    being sent into mux1 trunk as
        '[tag]something'
*/
function BatMux (id, server_url) {
    EventEmitter.call(this);
    this.server_url = server_url;
    this.trunk = new BatStream();
    this.branches = {};
    this.data = [];
    this.chop = '';
    this.url_r = '';
    this.active_tag_w = '';
    this.end = false;
    this.trunk.pair.on('data', this.onTrunkDataIn.bind(this));
    this.trunk.pair.on('end', this.onTrunkDataEnd.bind(this));
}
util.inherits(BatMux, EventEmitter);
module.exports = BatMux;
BatMux.tag_re = /\[([\w\:\/\#\.\_\~]+)\]/;

BatMux.prototype.bat_connect = function (uri, bat_stream) {
    var self = this;
    var tag = uri; // TODO parse
    this.branches[tag] = bat_stream;
    bat_stream.on('data', function(data){
        self.onBranchDataIn(tag, data);
    });
    bat_stream.on('end', function(){
        self.onBranchEnd(tag);
    });
};

BatMux.prototype.onBranchDataIn = function (tag, data) {
    if (this.active_tag_w!==tag) {
        this.active_tag_w = tag;
        this.trunk.pair.write('['+tag+']');
    }
    this.trunk.pair.write(data.toString());
};

BatMux.prototype.onBranchEnd = function (tag) {
    if (this.active_tag_w!==tag) {
        this.active_tag_w = tag;
        this.trunk.pair.write('['+tag+']');
    }
    this.trunk.pair.write('[EOF]');
    this.branches[tag] = null;
    if (this.end) {
        var tags = Object.keys(this.branches), self=this;
        var have_more = tags.some(function(tag){
            return self.branches[tag]!==null;
        });
        if (!have_more) {
            this.trunk.pair.end();
        }
    }
};

BatMux.prototype.connect = function (url) {
    var self = this;
    stream_url.connect(url, function(err, stream){
        if (err) {
            self.emit('error', err);
            self.data = null;
            return;
        }
        self.branches[url] = stream;
        stream.on('data', function(data){
            self.onBranchDataIn(url, data);
        });
        stream.on('end', function(){
            self.onBranchEnd(url);
        });
        self.drain();
    });
};

BatMux.prototype.onTrunkDataIn = function (data) {
    if (this.data===null) {
        throw new Error('this muxer is broken');
    }
    var chop = data.toString(), m, li=0;
    var re = /\[([^\]]+)\]/mg;
    while (m = re.exec(chop)) {
        if (m.index>li) {
            this.data.push(chop.substring(li,m.index));
        }
        this.data.push(new BatMux.To(m[1]));
        li = m.index + m[0].length;
    }
    if (li<chop.length) {
        this.data.push(chop.substr(li));
    }
    this.drain();
};

BatMux.To = function MuxTo(url) {
    this.url = url;
};

BatMux.To.prototype.toString = function () {
    return '[' + this.url + ']';
};


BatMux.prototype.drain = function () {
    while (this.data.length) {
        var next = this.data.shift();
        if (next.constructor===BatMux.To) {
            this.url_r = next.url.toString();
            if (!(this.url_r in this.branches)) {
                this.connect(this.url_r);
                break;
            }
        } else {
            if (!this.url_r) {
                this.emit('error', 'no active stream');
                this.data = null;
                return;
            }
            var stream = this.branches[this.url_r];
            if (stream) {
                stream.write(next);
            } else { // the stream is not ready yet
                this.data.unshift(next);
                break;
            }
        }
    }
    if (!this.data.length && this.end) {
        this.onTrunkDataEnd();
    }
};

BatMux.prototype.onTrunkDataEnd = function () {
    for(var tag in this.branches) {
        this.branches[tag].end();
    }
    this.end = true;
};