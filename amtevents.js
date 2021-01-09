/**
* @description MeshCentral Intel(R) AMT Event Parser
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2021
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a MeshAgent object, called upon connection
module.exports.CreateAmtEventsHandler = function (parent) {
    var obj = {};
    obj.parent = parent;

    // Private method
    function ParseWsman(xml) {
        try {
            if (!xml.childNodes) xml = _turnToXml(xml);
            var r = { Header: {} }, header = xml.getElementsByTagName("Header")[0], t;
            if (!header) header = xml.getElementsByTagName("a:Header")[0];
            if (!header) return null;
            for (var i = 0; i < header.childNodes.length; i++) {
                var child = header.childNodes[i];
                r.Header[child.localName] = child.textContent;
            }
            var body = xml.getElementsByTagName("Body")[0];
            if (!body) body = xml.getElementsByTagName("a:Body")[0];
            if (!body) return null;
            if (body.childNodes.length > 0) {
                t = body.childNodes[0].localName;
                var x = t.indexOf('_OUTPUT');
                if ((x != -1) && (x == (t.length - 7))) { t = t.substring(0, t.length - 7); }
                r.Header.Method = t;
                r.Body = _ParseWsmanRec(body.childNodes[0]);
            }
            return r;
        } catch (e) {
            console.log("Unable to parse XML: " + xml);
            return null;
        }
    }

    // Private method
    function _ParseWsmanRec(node) {
        var data, r = {};
        for (var i = 0; i < node.childNodes.length; i++) {
            var child = node.childNodes[i];
            if (child.childNodes == null) { data = child.textContent; } else { data = _ParseWsmanRec(child); }
            if (data == 'true') data = true; // Convert 'true' into true
            if (data == 'false') data = false; // Convert 'false' into false

            var childObj = data;
            if (child.attributes != null) {
                childObj = { 'Value': data };
                for (var j = 0; j < child.attributes.length; j++) {
                    childObj['@' + child.attributes[j].name] = child.attributes[j].value;
                }
            }

            if (r[child.localName] instanceof Array) { r[child.localName].push(childObj); }
            else if (r[child.localName] == undefined) { r[child.localName] = childObj; }
            else { r[child.localName] = [r[child.localName], childObj]; }
        }
        return r;
    }

    // Private method
    function _turnToXml(text) {
        var DOMParser = require('xmldom').DOMParser;
        return new DOMParser().parseFromString(text, 'text/xml');
    }

    // Parse and handle an event coming from Intel AMT
    obj.handleAmtEvent = function (data, nodeid, amthost) {
        var x = ParseWsman(data);
        if (x != null) {
            // TODO: Dispatch this event, we need to keep a running Intel AMT log for each machine.
            console.log('Got Intel AMT event from ' + amthost + ', nodeid: ' + nodeid.substring(0, 8));
            //console.log(x);
        }
        return x;
    };

    // DEBUG: This is an example event, to test parsing and dispatching
    //obj.handleAmtEvent('<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_AlertIndication" xmlns:h="http://schemas.dmtf.org/wbem/wscim/1/common" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><a:Header><b:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:To><b:ReplyTo><b:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:Address></b:ReplyTo><c:AckRequested></c:AckRequested><b:Action a:mustUnderstand="true">http://schemas.dmtf.org/wbem/wsman/1/wsman/Event</b:Action><b:MessageID>uuid:00000000-8086-8086-8086-000000128538</b:MessageID><c:ResourceURI>http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_AlertIndication</c:ResourceURI></a:Header><a:Body><g:CIM_AlertIndication><g:AlertType>8</g:AlertType><g:AlertingElementFormat>2</g:AlertingElementFormat><g:AlertingManagedElement>Interop:CIM_ComputerSystem.CreationClassName=&quot;CIM_ComputerSystem&quot;,Name=&quot;Intel(r) AMT&quot;</g:AlertingManagedElement><g:IndicationFilterName>Intel(r) AMT:AllEvents</g:IndicationFilterName><g:IndicationIdentifier>Intel(r):2950234687</g:IndicationIdentifier><g:IndicationTime><h:Datetime>2017-01-31T15:40:09.000Z</h:Datetime></g:IndicationTime><g:Message></g:Message><g:MessageArguments>0</g:MessageArguments><g:MessageArguments>Interop:CIM_ComputerSystem.CreationClassName=CIM_ComputerSystem,Name=Intel(r) AMT</g:MessageArguments><g:MessageID>iAMT0005</g:MessageID><g:OtherAlertingElementFormat></g:OtherAlertingElementFormat><g:OtherSeverity></g:OtherSeverity><g:OwningEntity>Intel(r) AMT</g:OwningEntity><g:PerceivedSeverity>2</g:PerceivedSeverity><g:ProbableCause>0</g:ProbableCause><g:SystemName>Intel(r) AMT</g:SystemName></g:CIM_AlertIndication></a:Body></a:Envelope>', 'aabbccdd', '1.2.3.4');

    return obj;
};
