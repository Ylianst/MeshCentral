/*
Copyright 2018-2019 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

try { Object.defineProperty(Array.prototype, "peek", { value: function () { return (this.length > 0 ? this[this.length - 1] : undefined); } }); } catch (e) { }


// Parse XML and return JSON
module.exports.ParseWsman = function (xml) {
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
            if (t.indexOf("_OUTPUT") == t.length - 7) { t = t.substring(0, t.length - 7); }
            r.Header['Method'] = t;
            r.Body = _ParseWsmanRec(body.childNodes[0]);
        }
        return r;
    } catch (e) {
        console.error("Unable to parse XML: " + xml, e);
        return null;
    }
}

// Private method
function _ParseWsmanRec(node) {
    var data, r = {};
    for (var i = 0; i < node.childNodes.length; i++) {
        var child = node.childNodes[i];
        if ((child.childElementCount == null) || (child.childElementCount == 0)) { data = child.textContent; } else { data = _ParseWsmanRec(child); }
        if (data == 'true') data = true; // Convert 'true' into true
        if (data == 'false') data = false; // Convert 'false' into false
        if ((parseInt(data) + '') === data) data = parseInt(data); // Convert integers

        var childObj = data;
        if ((child.attributes != null) && (child.attributes.length > 0)) {
            childObj = { 'Value': data };
            for (var j = 0; j < child.attributes.length; j++) {
                childObj['@' + child.attributes[j].name] = child.attributes[j].value;
            }
        }

        if (r[child.localName] instanceof Array) { r[child.localName].push(childObj); }
        else if (r[child.localName] == null) { r[child.localName] = childObj; }
        else { r[child.localName] = [r[child.localName], childObj]; }
    }
    return r;
}

function _PutObjToBodyXml(resuri, putObj) {
    if (!resuri || putObj == null) return '';
    var objname = obj.GetNameFromUrl(resuri);
    var result = '<r:' + objname + ' xmlns:r="' + resuri + '">';

    for (var prop in putObj) {
        if (!putObj.hasOwnProperty(prop) || prop.indexOf('__') === 0 || prop.indexOf('@') === 0) continue;
        if (putObj[prop] == null || typeof putObj[prop] === 'function') continue;
        if (typeof putObj[prop] === 'object' && putObj[prop]['ReferenceParameters']) {
            result += '<r:' + prop + '><a:Address>' + putObj[prop].Address + '</a:Address><a:ReferenceParameters><w:ResourceURI>' + putObj[prop]['ReferenceParameters']["ResourceURI"] + '</w:ResourceURI><w:SelectorSet>';
            var selectorArray = putObj[prop]['ReferenceParameters']['SelectorSet']['Selector'];
            if (Array.isArray(selectorArray)) {
                for (var i = 0; i < selectorArray.length; i++) {
                    result += '<w:Selector' + _ObjectToXmlAttributes(selectorArray[i]) + '>' + selectorArray[i]['Value'] + '</w:Selector>';
                }
            }
            else {
                result += '<w:Selector' + _ObjectToXmlAttributes(selectorArray) + '>' + selectorArray['Value'] + '</w:Selector>';
            }
            result += '</w:SelectorSet></a:ReferenceParameters></r:' + prop + '>';
        }
        else {
            if (Array.isArray(putObj[prop])) {
                for (var i = 0; i < putObj[prop].length; i++) {
                    result += '<r:' + prop + '>' + putObj[prop][i].toString() + '</r:' + prop + '>';
                }
            } else {
                result += '<r:' + prop + '>' + putObj[prop].toString() + '</r:' + prop + '>';
            }
        }
    }

    result += '</r:' + objname + '>';
    return result;
}

// This is a drop-in replacement to _turnToXml() that works without xml parser dependency.
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
    try {
        if (text == null) return null;
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
    } catch (ex) { return null; }
    return lastElement;
}
