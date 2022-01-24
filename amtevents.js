/**
* @description MeshCentral Intel(R) AMT Event Parser
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2022
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

    // This is a drop-in replacement to _turnToXml() that works without xml parser dependency.
    try { Object.defineProperty(Array.prototype, "peek", { value: function () { return (this.length > 0 ? this[this.length - 1] : null); } }); } catch (ex) { }
    function _treeBuilder() {
        this.tree = [];
        this.push = function (element) { this.tree.push(element); };
        this.pop = function () { var element = this.tree.pop(); if (this.tree.length > 0) { var x = this.tree.peek(); x.childNodes.push(element); x.childElementCount = x.childNodes.length; } return (element); };
        this.peek = function () { return (this.tree.peek()); }
        this.addNamespace = function (prefix, namespace) { this.tree.peek().nsTable[prefix] = namespace; if (this.tree.peek().attributes.length > 0) { for (var i = 0; i < this.tree.peek().attributes; ++i) { var a = this.tree.peek().attributes[i]; if (prefix == '*' && a.name == a.localName) { a.namespace = namespace; } else if (prefix != '*' && a.name != a.localName) { var pfx = a.name.split(':')[0]; if (pfx == prefix) { a.namespace = namespace; } } } } }
        this.getNamespace = function (prefix) { for (var i = this.tree.length - 1; i >= 0; --i) { if (this.tree[i].nsTable[prefix] != null) { return (this.tree[i].nsTable[prefix]); } } return null; }
    }
    function _turnToXml(text) { if (text == null) return null; return ({ childNodes: [_turnToXmlRec(text)], getElementsByTagName: _getElementsByTagName, getChildElementsByTagName: _getChildElementsByTagName, getElementsByTagNameNS: _getElementsByTagNameNS }); }
    function _getElementsByTagNameNS(ns, name) { var ret = []; _xmlTraverseAllRec(this.childNodes, function (node) { if (node.localName == name && (node.namespace == ns || ns == '*')) { ret.push(node); } }); return ret; }
    function _getElementsByTagName(name) { var ret = []; _xmlTraverseAllRec(this.childNodes, function (node) { if (node.localName == name) { ret.push(node); } }); return ret; }
    function _getChildElementsByTagName(name) { var ret = []; if (this.childNodes != null) { for (var node in this.childNodes) { if (this.childNodes[node].localName == name) { ret.push(this.childNodes[node]); } } } return (ret); }
    function _getChildElementsByTagNameNS(ns, name) { var ret = []; if (this.childNodes != null) { for (var node in this.childNodes) { if (this.childNodes[node].localName == name && (ns == '*' || this.childNodes[node].namespace == ns)) { ret.push(this.childNodes[node]); } } } return (ret); }
    function _xmlTraverseAllRec(nodes, func) { for (var i in nodes) { func(nodes[i]); if (nodes[i].childNodes) { _xmlTraverseAllRec(nodes[i].childNodes, func); } } }
    function _turnToXmlRec(text) {
        var elementStack = new _treeBuilder(), lastElement = null, x1 = text.split('<'), ret = [], element = null, currentElementName = null;
        for (var i in x1) {
            var x2 = x1[i].split('>'), x3 = x2[0].split(' '), elementName = x3[0];
            if ((elementName.length > 0) && (elementName[0] != '?')) {
                if (elementName[0] != '/') {
                    var attributes = [], localName, localname2 = elementName.split(' ')[0].split(':'), localName = (localname2.length > 1) ? localname2[1] : localname2[0];
                    Object.defineProperty(attributes, "get",
                        {
                            value: function () {
                                if (arguments.length == 1) {
                                    for (var a in this) { if (this[a].name == arguments[0]) { return (this[a]); } }
                                }
                                else if (arguments.length == 2) {
                                    for (var a in this) { if (this[a].name == arguments[1] && (arguments[0] == '*' || this[a].namespace == arguments[0])) { return (this[a]); } }
                                }
                                else {
                                    throw ('attributes.get(): Invalid number of parameters');
                                }
                            }
                        });
                    elementStack.push({ name: elementName, localName: localName, getChildElementsByTagName: _getChildElementsByTagName, getElementsByTagNameNS: _getElementsByTagNameNS, getChildElementsByTagNameNS: _getChildElementsByTagNameNS, attributes: attributes, childNodes: [], nsTable: {} });
                    // Parse Attributes
                    if (x3.length > 0) {
                        var skip = false;
                        for (var j in x3) {
                            if (x3[j] == '/') {
                                // This is an empty Element
                                elementStack.peek().namespace = elementStack.peek().name == elementStack.peek().localName ? elementStack.getNamespace('*') : elementStack.getNamespace(elementStack.peek().name.substring(0, elementStack.peek().name.indexOf(':')));
                                elementStack.peek().textContent = '';
                                lastElement = elementStack.pop();
                                skip = true;
                                break;
                            }
                            var k = x3[j].indexOf('=');
                            if (k > 0) {
                                var attrName = x3[j].substring(0, k);
                                var attrValue = x3[j].substring(k + 2, x3[j].length - 1);
                                var attrNS = elementStack.getNamespace('*');

                                if (attrName == 'xmlns') {
                                    elementStack.addNamespace('*', attrValue);
                                    attrNS = attrValue;
                                } else if (attrName.startsWith('xmlns:')) {
                                    elementStack.addNamespace(attrName.substring(6), attrValue);
                                } else {
                                    var ax = attrName.split(':');
                                    if (ax.length == 2) { attrName = ax[1]; attrNS = elementStack.getNamespace(ax[0]); }
                                }
                                var x = { name: attrName, value: attrValue }
                                if (attrNS != null) x.namespace = attrNS;
                                elementStack.peek().attributes.push(x);
                            }
                        }
                        if (skip) { continue; }
                    }
                    elementStack.peek().namespace = elementStack.peek().name == elementStack.peek().localName ? elementStack.getNamespace('*') : elementStack.getNamespace(elementStack.peek().name.substring(0, elementStack.peek().name.indexOf(':')));
                    if (x2[1]) { elementStack.peek().textContent = x2[1]; }
                } else { lastElement = elementStack.pop(); }
            }
        }
        return lastElement;
    }

    return obj;
};
