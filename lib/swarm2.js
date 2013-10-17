/*if (typeof require === 'function') {
    _ = require('underscore');
}*/

exports = ( function () {

    /*var Swarm = {types:{}};

    Swarm.isBrowser = typeof(document)=='object';
    Swarm.isServer = !Swarm.isBrowser;
    */

    //  S P E C I F I E R
    //  is a compound event id that fully and uniquely specifies a change.
    //  Specs include class, object id, timestamp, member/method affected
    //  and the author of the change. Every spec's token is prefixed with
    //  a "quant", i.e. a symbol in the range [!-/]. A serialized spec
    //  has a form of /ClassName#objectId.memberName!timeStamp&changeAuthor
    //  A token may have an optional extension prefixed with '+', e.g.
    //  &userName+sessionId or !timeStamp+serialNumber. Tokens are Base64.

    var Spec = Swarm.Spec = function Spec (copy,scope) {
        var t = this;
        t.type=t.id=t.member=t.version=null;
        if (!copy) return;
        if (Spec.reTokExt.test(copy) && scope)  // TODO rewrite: attacks
            copy = scope.child(copy);
        if (copy.constructor===Spec) {
            t.type = copy.type;
            t.id = copy.id;
            t.member = copy.member;
            t.version = copy.version;
        } else {
            scope && this.scope(scope);
            var m = [];
            copy = copy.toString();
            while (m=Spec.reQTokExt.exec(copy))
                switch (m[1]) {
                    case '/': t.type=m[2]; break;
                    case '#': t.id=m[2]; break;
                    case '.': t.member=m[2]; break;
                    case '!': t.version=m[2]; break;
                }
        }
    };

    Spec.rT = '[0-9A-Za-z_@]+';
    Spec.reTokExt = new RegExp('^(=)(?:\\+(=))?$'.replace(/=/g,Spec.rT));
    Spec.reQTokExt = new RegExp('([/#\\.!])(=(?:\\+=)?)'.replace(/=/g,Spec.rT),'g');
    Spec.toks = {type:'/',id:'#',member:'.',version:'!'};

    Spec.prototype.toString = function () {
        return ((this.type?'/'+this.type:'')+
                (this.id?'#'+this.id:'')+
                (this.member?'.'+this.member:'')+
                (this.version?'!'+this.version:'')) || '/';
    };

    Spec.bare = function (tok) { return Spec.reTokExt.exec(tok)[1]; }
    Spec.ext = function (tok) { return Spec.reTokExt.exec(tok)[2]||''; }

    // Considers this specifier in the context of another; returns
    // the difference. For example, `/a#b.c` within `/a#b` is `.c`.
    // `/a#b` within `/a#b.c` returns `null` (because the latter
    // specifier is more specific).
    /*Spec.prototype.within = function (scope) {
        var copy = new Spec(this);
        for(var f in copy)
            if (copy.hasOwnProperty(f))
                if (scope[f])
                    if (scope[f]===copy[f])
                        copy[f]=null;
                    else
                        return null;
        return copy;
    };*/

    Spec.prototype.scope = function (scope) {
        scope.type && (this.type=scope.type);
        scope.id && (this.id=scope.id);
        scope.member && (this.member=scope.member);
        scope.version && (this.version=scope.version);
    };

    Spec.prototype.isEmpty = function () {
        return !this.type&&!this.id&&!this.member&&!this.version;
    };

    Spec.EPOCH = 1262275200000; // 1 Jan 2010 (milliseconds)
    Spec.MAX_SYNC_TIME = 60*60000; // 1 hour (milliseconds)

    /** Swarm employs 30bit integer Unix-like timestamps starting epoch at
     *  1 Jan 2010. Timestamps are encoded as 5-char base64 tokens; in case
     *  several events are generated by the same process at the same second
     *  then sequence number is added so a timestamp may be more than 5
     *  chars. */
    Spec.date2ts = function (date,seq) {
        var ret = [];
        var d = date.getTime();
        d -= Spec.EPOCH;
        for(var i=0; i<5; i++) {
            ret.push(Spec.base64.charAt(d&63));
            d>>=6;
        }
        while (seq) {
            ret.push(Spec.base64.charAt(seq&63));
            seq>>=6;
        }
        var str64 = ret.reverse().join('');
        return str64;
    };

    // don't need it much
    Spec.ts2date = function () {
    };

    Spec.newVersion = function () {
        if (!Swarm.root.author) throw new Error('Swarm.author not set');
        if (Spec.frozen)
            return Spec.frozen;
        var ts = Spec.date2ts(new Date());
        return ts + '+' + Swarm.root.author;
    };
    Spec.frozen = null;
    Spec.freezes = 0;

    Spec.freeze = function () {
        if (!Spec.freezes++)
            Spec.frozen = Spec.newVersion();
    };
    Spec.thaw = function () { 
        if (!--Spec.freezes)
            Spec.frozen = null;
    }

    Spec.prototype.parent = function () {
        var ret = new Spec(this);
        if (ret.version) ret.version = null;
        else if (ret.member) ret.member = null;
        else if (ret.id) ret.id = null;
        else if (ret.type) ret.type = null;
        return ret;
    };

    Spec.prototype.child = function (id) {
        var child = new Spec(this);
        if (!child.type) child.type=id;
        else if (!child.id) child.id=id;
        else if (!child.member) child.member=id;
        else if (!child.version) child.version=id;
        return child;
    };

    Spec.base64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~';

    // 3-parameter signature
    //  * specifier (or a base64 string)
    //  * value anything but a function
    //  * source/callback - anything that can receive events
    Spec.normalizeSig3 = function (host, args) {
        var len = args.length;
        if (len===0 || len>3) throw new Error('invalid number of arguments');
        if (typeof(args[len-1])==='function')
            args[len-1] = {set:args[len-1]}; /// BAD
        if (len<3 && typeof(args[len-1].set)==='function') {
            args[2] = args[len-1];
            args[len-1] = null;
        }
        // args[0] can't be a value... yet
        if (!args[0] || args[0].constructor!==Spec) {
            args[0] = new Spec(args[0],host.scope());
        }
    };

    // R E L A Y  N O D E

        /** Reciprocal `on` *
        reOn: function (spec,base,newln) {
            // an internal method, no signature normalization needed
            this.respond(spec,base,newln);
            this._lstn.push(newln);
        },
        /** may respond with a diff *
        onOn: function (spec,base,src) {
        },
        off: function (filter,novalue,oldln) {
            // TODO normalization (TDD)
            filter = new Spec(filter);
            if (this.fwdOn) {
                var fwd = this.fwdOn(filter);
                if (fwd)
                    return fwd.off(filter,novalue,oldln);
            }
            var lstn = this._lstn;
            var i = lstn.indexOf(oldln);
            if (i===-1) {
                for(var i=0; i<lstn.length && lstn[i].ln!==oldln; i++);
                if (i===lstn.length)
                    throw new Error('unknown listener');
            }
            lstn[i] = lstn[lstn.length-1];
            lstn.pop();
        },
        */
    

    function EventRelay (id) {
        this.init(id);
    }
    
    EventRelay.extend = function(fn,own) {
        var fnproto = fn.prototype, myproto = this.prototype;
        for (var prop in myproto)
            fnproto[prop] = myproto[prop];
        for (var prop in own)
            fnproto[prop] = own[prop];
        for(var prop in this)
            if (typeof(this[prop])==='function')
                fn[prop] = this[prop]; // ???
        //fnproto._super = myproto;
        fn.extend = EventRelay.extend;
        return fn;
    };

    var EvRelayProto = EventRelay.prototype;

    /** We need to serve 2 entry points: new Model(id) and
     *  model.set('field',val) */
    EvRelayProto.init = function () {
        Spec.normalizeSig3(this,arguments);
        var spec=arguments[0], value=arguments[1], parent=arguments[2];
        this._lstn = [];
        // _id or _parent may be defined in the prototype
        this._id = this._id || spec[this._specKey];
        
        this._children = this._children || {};
        var kids = this.constructor.defaultChildren;
        if (kids) 
            for (var cid in kids)
                this._children[cid] = new kids[cid].type(cid,kids[cid].value,this);

        parent = parent || Swarm.root.obtain(this.scope().parent());
        if (this._id in parent._children)
            throw new Error('duplicate instantiation: '+spec);
        parent._children[this._id] = this;
    };

    EvRelayProto.child = function (id) {
        return this._children[id];
    };

    // descends the entity hierarchy to find an object by the specifier;
    // may construct objects in the process
    EvRelayProto.obtain = function () {
        Spec.normalizeSig3(this,arguments);
        var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        var pick = spec[this._childKey];
        if (!pick) return this;
        if (pick in this._children)
            return this._children[pick];
        if (!this.defaultChild)
            throw new Error('no such child: '+spec);
        return new (this.defaultChild)(pick).obtain(spec,this.defaultChildValue,this);
    };

    // TODO  deliver() boilerplate

    EvRelayProto.on = function () {
        Spec.normalizeSig3(this,arguments);
        var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        if (this.acl && !this.acl(spec,'on'))
            throw new Error('access denied: '+spec);
            
        var childId = spec[this._childKey];
        if (childId) {
            var child = this._children[childId]; // TODO || this.create(childId);
            return child.on(spec,value,lstn);
        } else {
            if (!this._lstn) this._lstn=[];
            this._lstn.push(lstn);
            if (this.onOn)
                this.onOn(spec,value,lstn);
        }
    };

    EvRelayProto.off = function () {
        Spec.normalizeSig3(this,arguments);
        var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        var childId = spec[this._childKey];
        if (childId) {
            var child = this._children[childId]; // || this.create(childId);
            if (!child) throw new Error('child unknown: '+spec);
            return child.off(spec,value,lstn);
        } else {
            var i = this._lstn.indexOf(lstn);
            if (i===-1) { // TODO
            }
            this._lstn.splice(i,1);
            if (this.onOff)
                this.onOff(spec,value,lstn);
        }
    };

    EvRelayProto.set = function () {
        Spec.normalizeSig3(this,arguments);
        var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        if (this.acl && !this.acl(spec,'set'))
            throw new Error('access denied: '+spec);
        var childId = this._childKey && spec[this._childKey];
        if (childId) {
            var child = this._children[childId]; // || this.create(childId);
            if (!child) throw new Error('child unknown: '+spec);
            return child.set(spec,value,lstn);
        } else {
            if (this.validate && !this.validate(spec,value,lstn))
                throw new Error('invalid value: '+spec);
            this.apply(spec,value,lstn);
            this.emit(spec,value,lstn);
        }
    };

    EvRelayProto.apply = function () {
        throw new Error('no apply() defined');
    };

    EvRelayProto.emit = function () {
        Spec.normalizeSig3(this,arguments);
        var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        if (this._lstn)
            for(var i=0; i<this._lstn.length; i++)
                this._lstn[i].set(spec,value);
    };

    EvRelayProto.close = function () {
        if (this._id!=='/')
            Swarm.root.obtain(this.spec().parent())._children[this._id] = undefined; // FIXME sucks
        if (this._lstn)
            for(var i=0; i<this._lstn.length; i++)
                this._lstn[i].off(this);
    };

    function Swarm (author) {
        if (Swarm.root)
            throw new Error('duplicate root object construction');
        Swarm.root = this;
        this._id = '/';
        this.init(new Spec());
        this.author = author;
    }

    EventRelay.extend(Swarm, {
        _childKey: 'type',
        defaultChild: Type,
        defaultChildren: {},
        scope: function () {
            return new Spec();
        },
        close: function () {
            EventRelay.prototype.close.call(this);
            Swarm.root = null;
            this._children = {};
        },
        connect: function () {
        }
    });

    function Type (name,constructor) {
        this.init(name);
        this.constructor = constructor;
    }

    EventRelay.extend(Type, {
        scope: function () {
            var spec = new Spec();
            spec.type = this.constructor.id;
            return spec;
        }
        /*init: function (id, constructor) {
            this.super().init.call(this,id);
            this.constructor = constructor || Model;
        }
        create: function typeCreate (spec) {
            spec = new Spec(spec,'#');
            spec.time = Spec.timestamp();
            spec.author = Spec.author;
            if (!spec.id)  //  TODO compact ids    #t6_S4seq+gritzko
                spec.id = spec.time.replace('+','_')+'+'+spec.author.replace('+','_');
            var obj = new this.constructor(spec.id);
        }*/
    });

    
    Swarm.addType = function (constructor,name) {
        if (typeof(constructor.extend)!=='function')
            Model.extend(constructor); // Model by default (may be Set, View, Stub as well)
        name = name || constructor.name;
        constructor.id = name;
        Swarm.prototype.defaultChildren[name] = {
            type: Type,
            value: constructor
        };
        if (Swarm.root) // late construction
            Swarm.root._children[name] = new Type(name,constructor,Swarm.root);
    };
    Swarm.prototype.childConstructors = {};

    function Model (id) {
        this.init(id);
    }

    EventRelay.extend( Model, {
        _childKey: 'member',
        _specKey: 'id', // FIXME derive
        scope: function () {
            var ret = new Spec();
            ret.type = this.constructor.id;
            ret.id = this._id;
            return ret;
        },
        init: function (id) {
            EventRelay.prototype.init.apply(this,arguments);
            var fp = this.constructor.fieldTypes;
            for(var name in fp) // TODO confusing: model 'types' vs field 'types'
                this._children[name] = new fp[name].type(name,fp[name].value);
        },
        /*apply: function(spec,value,src) {
            if (spec.member in this._loggedMethods) {
                this.invoke(spec,value,src);
            } else {
                if (!(k in this._trackedFields))
                    throw new Error('unknown field');
                (this._mergeable ? this.merge:this.update)(spec,value,src);
            }
        },
        invoke: function(spec,value,src) {
            // stub is installed
            if (value.constructor===Array)
                this._loggedMethods[spec.member].apply(this,value);
            else
                this._loggedMethods[spec.member](value);
        },
        update: function(spec,value,src) {
            if (spec.vid() < this._vid)
                throw new Error('update replay');
            this[spec.member] = value;
            this._vid = spec.vid();
        },
        merge: function (spec,value,src) {
            if (spec.vid() < this._vid[spec.member])
                throw new Error('update replay');
            this[spec.member] = value;
            this._vid[spec.member] = spec.vid();
        },*/
        // we may react with a reciprocal subscription
        onOn: function() {
            Spec.normalizeSig3(this,arguments);
            var spec=arguments[0], value=arguments[1], lstn=arguments[2];
            if (value && lstn && typeof(lstn.set)==='function') {
                var diff = this.diff(value);
                if (diff)
                    lstn.set(this.spec(),diff,this);
            }
            if (lstn && typeof(lstn.reOn)==='function')
                lstn.reOn(spec,value,this);
        },
        onOff: function () {
        },
        diff: function (base) {
        }
    });


    Swarm.prototype.addModel = function (constructor,name) {
        Model.extend(constructor);
        name = name || constructor.name;
        return this.create(name,constructor);
    };

    Model.addMethod = function () {
    };

    Model.addCall = function () {
    };

    function Set (id) {
        this.init(id);
    }

    EventRelay.extend(Set, {
        apply: function () {
            Spec.normalizeSig3(this,arguments);
            var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        },
        onOn: function () {
            Spec.normalizeSig3(this,arguments);
            var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        },
        onOff: function () {
            Spec.normalizeSig3(this,arguments);
            var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        },
        create: function () {
            Spec.normalizeSig3(this,arguments);
            var spec=arguments[0], value=arguments[1], lstn=arguments[2];
        }
    });

    function Field (name) { // TODO new subtypes; _id in the proto
        this.init(name);
    }

    EventRelay.extend(Field, {
        _children: null,
        init: function (id,value) {
            //this._id = id; // _id is in the prototype already
            if (value) {
                this.value = value;
                this.version = Spec.newVersion();
            } else {
                this.value = this.constructor.defaultValue;
                this.version = '';
            }
        },
        apply: function () {
            Spec.normalizeSig3(this,arguments);
            var spec=arguments[0], value=arguments[1], lstn=arguments[2];
            if (this.validate && !this.validate(spec,value,lstn))
                throw new Error('invalid value: '+value);
            this.value = value;
            if (!spec.vid)
                spec.vid = Spec.newVersion();
            this.vid = spec.vid;
            //Swarm.relay(spec,value,lstn);
        }
    });


    Model.addProperty = function (name, value, type) {
        if (typeof(this)!=='function' || typeof(this.prototype.on)!=='function')
            throw new Error('you are doing it wrong');
        var proto = this.prototype;
        proto[name] = function (val) {
            if (val)
                return this.set(name,val);
            else
                return this.fields[name].value;
        };
        this.fieldTypes || (this.fieldTypes={});
        this.fieldTypes[name] = {
            type: type || Field,
            value: value || null
        };
    };

    Model.addLoggedMethod = function (proto, name, func) {
        proto[name] = function () {
            this.set(name,arguments,this);
        }
        proto._loggedMethods = proto._logged || {};
        proto._loggedMethods[name] = func;
    };


    var View = function (id,htmlTemplate) {
        // model.on
        id = Spec.as(id);
        if (!id.type || !id.id) throw 'need a /full#id';
        this._id;
        this.template = _.template(htmlTemplate);
        this.html = '';
        this.model = Swarm.on(id,this);
    }

    View.prototype.init = function () {
        var up = this.findUplink();
        up.on(this._id,this); // ????  spec
    };

    View.prototype.on = function () {
        // that's the model's reciprocal on
        // or superview?
    };

    View.prototype.off = function () {
        // nevermind
    };

    View.prototype.set = function (key,val,spec,src) {
        // original vs relayed set()
        if (!spec || !Spec.as(spec).time)
            return this.model.set(key,val,spec,this);
        this.render();
        if (Swarm.isServer)
            return;
        var container = document.getElementById(this.spec());
        if (!container)
            return this.close();
        // preserve nested elements
        container.innerHTML = this.html;
        // insert subelements
        container.getElementsByTagName('ins');
        for(;;);
            // if have element => reinsert
            // otherwise: create child view
    };

    View.prototype.render = function () {
        this.html = this.template(this.model);
    };

    View.extend = function () {
    };

    function Transport () {
    }

    Transport.prototype.on = function (spec,ln) {
        this._lstn[_id] = ln;
        this.pipe.send(specOn,ln.getBase?ln.getBase():'');
        // there is a mistery here
        // * whether we keep a map of listeners and multiplex
        // * or we go Swarm>Class>Object
        // * once we have no listeners we will not close anyway 
        // * practical: we need a list of replicas to relink
        // * removing a listener might become tedious with 10000 entries
        // * reciprocal `on`: need a memo on every outstanding `on`
        //
        // local listeners are listed by id => may distinguish incoming vs
        // reciprocal `on` DONE  {id:listener}
    };

    Transport.prototype.off = function (spec,ln) {
    };

    // form inside
    Transport.prototype.set = function (key,val,spec,src) {
        if (spec==this.emittedSpec) return;
        this.pipe.send();
    };

    Transport.prototype.emit = function (key,val,spec,src) {
        spec = Spec.as(spec);
        var classobj = '/'+spec.type+'#'+spec.id;
        this._lstn[classobj].set(key,val,spec,this);
    };


/** Calculates a version vector for a given {member:vid} map */
Spec.getBase = function (vidMap) {
    if ('_vid' in vidMap) vidMap=vidMap['_vid'];
    if (vidMap.constructor===String)
        return { '_': new Spec(vidMap).time };
    var maxSrcTss={}, maxTs='';
    for(var member in vidMap) {
        var spec = new Spec(vidMap[member]);
        if (spec.time>maxTs) maxTs = spec.time;
        if ( spec.time > (maxSrcTss[spec.author]||'') )
            maxSrcTss[spec.author] = spec.time;
    }
    if (!maxTs) return '';
    var maxDate = new Date(Spec.timestamp2iso(maxTs));
    var limMs = maxDate.getTime() - Spec.MAX_SYNC_TIME;
    var limTs = Spec.iso2timestamp(new Date(limMs));
    var ret = {'_':limTs}; // TODO on sync: explicitly specify peer src base
    for(var src in maxSrcTss)
        if (maxSrcTss[src]>limTs)
            ret[src] = maxSrcTss[src]; // once
    return ret;
};

Spec.getDiff = function (base, obj) {
    var vids = obj._vid, m, ret=null;
    for(var member in vids) {
        var spec = new Spec(vids[member]);
        if ( vids[member] > '!'+(base[spec.author]||base['&_']||'') ) {
            ret = ret || {'_vid':{}};
            ret[member] = obj[member];
            ret._vid[member] = vids[member];
        }
    }
    return ret;
};

/**  Model (M of MVC)
 *   C of MVC invoke: local, RPC, logged
 * *

function Model (id) {
    this.init(id);
}

Model.prototype.init = function (id) {
    this._lstn = [];
    this._id = id;
    this._state = Model.EMPTY;
}
Model.EMPTY = 0;
Model.READY = 1;

/** on-off pattern is essentially an open/close handshake *
Model.prototype.on = function (key,ln,ext) {
    // ACL-read goes here

    this._lstn.push(key?{__key:key,ln:ln}:ln);

    /*if (ext.base) {
        var diff = this.diff(ext.base);
        if (diff)          // FIXME always even empty
            ln.set(this.spec(), diff, {src: this});
    }*
    // TODO uplink
}

Model.prototype.off = function (key,ln,ext) {
    var i = this._lstn.indexOf(ln);
    if (i>=0) {

    } else {
        for(i=0; i<this._lstn.length; i++) {

        }
    }
    if (_lstn.length===1) // uplink only
        this.close();
}

Model.prototype.set = function (key,val,ext) {
    // bundled sigs: same vid only!!! {key:val},{vid:vid} or key,val.{vid:vid} then
    // create vid if none
    // ACL-write goes here
    if (this._acl) {
        if (letWriteList.indexOf(spec.author)===-1)
            throw new Error('no rights: the author is not on ACL');
    } else {
        // get new Spec(this._vid._).author
        //if (spec.author!==creator)
        //    throw new Error('no rights: not an author');
    }
    if (!this._state)
        this._state = Model.READY;
    var spec = Spec.as(key);
    // absorb state
    if (spec.method) {
        this[spec.method].call(this,val);
        // mark vid for further RPC oplog sync
    } else if (spec.member) {
        if (member.charAt(0)==='_') throw new Error('no access');
        // actually compare version ids
        this[spec.member] = val;
        // remember vids
    } else
        throw new Error();

    this.emit(key,val,ext);
};
Model.prototype._state = Model.EMPTY;

Model.prototype.emit = function (key,val,ext) {
}

Model.prototype.close = function () {
    for(var i=0; i<this._lstn.length; i++) {
        var ln = this._lstn[i];
        ln.off(this);
    }
};
Model.types = {};
*/
    return {
        Swarm: Swarm,
        Spec:  Spec,
        Model: Model,
        Field: Field
    };

}());

if (typeof window === 'object') {
    for(key in exports)
        window[key] = exports[key];
} else {
    module.exports = exports;
}