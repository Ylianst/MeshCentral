/**
* @description MQTT broker reference implementation based on AEDES
* @author Joko Banu Sastriawan
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.1
*/


module.exports.CreateMQTTBroker = function (parent, db, args) {

    // internal objects container
    var obj = {}
    obj.parent = parent;
    obj.db = db;
    obj.args = args;

    obj.aedes = require("aedes")();


    // argument parsing -- tbd

    // event handling and filtering
    // authentication filter
    obj.aedes.authenticate = function (client, username, password, callback) {
        // accept all user
        // TODO: add authentication handler
        obj.parent.debug("mqtt","Authentication with "+username+":"+password);
        callback(null, true);
    }

    // check if a client can publish a packet
    obj.aedes.authorizePublish = function (client, packet, callback) {
        //TODO: add authorized publish control
        obj.parent.debug("mqtt","AuthorizePublish");
        callback(null);
    }

    // check if a client can publish a packet
    obj.aedes.authorizeSubscribe = function (client, sub, callback) {
        //TODO: add subscription control here
        obj.parent.debug("mqtt","AuthorizeSubscribe");
        callback(null, sub);
    }

    // check if a client can publish a packet
    obj.aedes.authorizeForward = function (client, packet) {
        //TODO: add forwarding control
        obj.parent.debug("mqtt","AuthorizeForward");
        return packet;
    }
    obj.handle = obj.aedes.handle;    
    return obj; 
}
