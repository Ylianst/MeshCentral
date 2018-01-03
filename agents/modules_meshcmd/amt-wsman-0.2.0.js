/** 
* @description Intel(r) AMT WSMAN Stack
* @author Ylian Saint-Hilaire
* @version v0.2.0
*/

// Construct a MeshServer object
function WsmanStackCreateService(CreateWsmanComm, host, port, user, pass, tls, extra) {
    var obj = {};
    //obj.onDebugMessage = null;          // Set to a function if you want to get debug messages.
    obj.NextMessageId = 1;              // Next message number, used to label WSMAN calls.
    obj.Address = '/wsman';
    obj.comm = new CreateWsmanComm(host, port, user, pass, tls, extra);

    obj.PerformAjax = function (postdata, callback, tag, pri, namespaces) {
        if (namespaces == null) namespaces = '';
        obj.comm.PerformAjax('<?xml version=\"1.0\" encoding=\"utf-8\"?><Envelope xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:w="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns=\"http://www.w3.org/2003/05/soap-envelope\" ' + namespaces + '><Header><a:Action>' + postdata, function (data, status, tag) {
            if (status != 200) { callback(obj, null, { Header: { HttpError: status } }, status, tag); return; }
            var wsresponse = obj.ParseWsman(data);
            if (!wsresponse || wsresponse == null) { callback(obj, null, { Header: { HttpError: status } }, 601, tag); } else { callback(obj, wsresponse.Header["ResourceURI"], wsresponse, 200, tag); }
        }, tag, pri);
    }

    // Private method
    //obj.Debug = function (msg) { /*console.log(msg);*/ }

    // Cancel all pending queries with given status
    obj.CancelAllQueries = function (s) { obj.comm.CancelAllQueries(s); }

    // Get the last element of a URI string
    obj.GetNameFromUrl = function (resuri) {
        var x = resuri.lastIndexOf("/");
        return (x == -1)?resuri:resuri.substring(x + 1);
    }

    // Perform a WSMAN Subscribe operation
    obj.ExecSubscribe = function (resuri, delivery, url, callback, tag, pri, selectors, opaque, user, pass) {
        var digest = "", digest2 = "", opaque = "";
        if (user != null && pass != null) { digest = '<t:IssuedTokens xmlns:t="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:se="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><t:RequestSecurityTokenResponse><t:TokenType>http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#UsernameToken</t:TokenType><t:RequestedSecurityToken><se:UsernameToken><se:Username>' + user + '</se:Username><se:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#PasswordText">' + pass + '</se:Password></se:UsernameToken></t:RequestedSecurityToken></t:RequestSecurityTokenResponse></t:IssuedTokens>'; digest2 = '<w:Auth Profile="http://schemas.dmtf.org/wbem/wsman/1/wsman/secprofile/http/digest"/>'; }
        if (opaque != null) { opaque = '<a:ReferenceParameters><m:arg>' + opaque + '</m:arg></a:ReferenceParameters>'; }
        if (delivery == 'PushWithAck') { delivery = 'dmtf.org/wbem/wsman/1/wsman/PushWithAck'; } else if (delivery == 'Push') { delivery = 'xmlsoap.org/ws/2004/08/eventing/DeliveryModes/Push'; }
        var data = "http://schemas.xmlsoap.org/ws/2004/08/eventing/Subscribe</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>" + _PutObjToSelectorsXml(selectors) + digest + '</Header><Body><e:Subscribe><e:Delivery Mode="http://schemas.' + delivery + '"><e:NotifyTo><a:Address>' + url + '</a:Address>' + opaque + '</e:NotifyTo>' + digest2 + '</e:Delivery></e:Subscribe>';
        obj.PerformAjax(data + "</Body></Envelope>", callback, tag, pri, 'xmlns:e="http://schemas.xmlsoap.org/ws/2004/08/eventing" xmlns:m="http://x.com"');
    }

    // Perform a WSMAN UnSubscribe operation
    obj.ExecUnSubscribe = function (resuri, callback, tag, pri, selectors) {
        var data = "http://schemas.xmlsoap.org/ws/2004/08/eventing/Unsubscribe</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>" + _PutObjToSelectorsXml(selectors) + '</Header><Body><e:Unsubscribe/>';
        obj.PerformAjax(data + "</Body></Envelope>", callback, tag, pri, 'xmlns:e="http://schemas.xmlsoap.org/ws/2004/08/eventing"');
    }

    // Perform a WSMAN PUT operation
    obj.ExecPut = function (resuri, putobj, callback, tag, pri, selectors) {
        var data = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Put</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60.000S</w:OperationTimeout>" + _PutObjToSelectorsXml(selectors) + '</Header><Body>' + _PutObjToBodyXml(resuri, putobj);
        obj.PerformAjax(data + "</Body></Envelope>", callback, tag, pri);
    }
		
    // Perform a WSMAN CREATE operation
    obj.ExecCreate = function (resuri, putobj, callback, tag, pri, selectors) {
        var objname = obj.GetNameFromUrl(resuri);
        var data = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout>" + _PutObjToSelectorsXml(selectors) + "</Header><Body><g:" + objname + " xmlns:g=\"" + resuri + "\">";
        for (var n in putobj) { data += "<g:" + n + ">" + putobj[n] + "</g:" + n + ">" } 
        obj.PerformAjax(data + "</g:" + objname + "></Body></Envelope>", callback, tag, pri);
    }

    // Perform a WSMAN DELETE operation
    obj.ExecDelete = function (resuri, putobj, callback, tag, pri) {
        var data = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout>" + _PutObjToSelectorsXml(putobj) + "</Header><Body /></Envelope>";
        obj.PerformAjax(data, callback, tag, pri);
    }

    // Perform a WSMAN GET operation
    obj.ExecGet = function (resuri, callback, tag, pri) {
        obj.PerformAjax("http://schemas.xmlsoap.org/ws/2004/09/transfer/Get</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout></Header><Body /></Envelope>", callback, tag, pri);
    }

	// Perform a WSMAN method call operation
    obj.ExecMethod = function (resuri, method, args, callback, tag, pri, selectors) {
        var argsxml = "";
        for (var i in args) { if (args[i] != null) { if (Array.isArray(args[i])) { for (var x in args[i]) { argsxml += "<r:" + i + ">" + args[i][x] + "</r:" + i + ">"; } } else { argsxml += "<r:" + i + ">" + args[i] + "</r:" + i + ">"; } } }
        obj.ExecMethodXml(resuri, method, argsxml, callback, tag, pri, selectors);
    }
	
    // Perform a WSMAN method call operation. The arguments are already formatted in XML.
    obj.ExecMethodXml = function (resuri, method, argsxml, callback, tag, pri, selectors) {
        obj.PerformAjax(resuri + "/" + method + "</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout>" + _PutObjToSelectorsXml(selectors) + "</Header><Body><r:" + method + '_INPUT' + " xmlns:r=\"" + resuri + "\">" + argsxml + "</r:" + method + "_INPUT></Body></Envelope>", callback, tag, pri);
    }

    // Perform a WSMAN ENUM operation
    obj.ExecEnum = function (resuri, callback, tag, pri) {
        obj.PerformAjax("http://schemas.xmlsoap.org/ws/2004/09/enumeration/Enumerate</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout></Header><Body><Enumerate xmlns=\"http://schemas.xmlsoap.org/ws/2004/09/enumeration\" /></Body></Envelope>", callback, tag, pri);
    }

    // Perform a WSMAN PULL operation
    obj.ExecPull = function (resuri, enumctx, callback, tag, pri) {
        obj.PerformAjax("http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout></Header><Body><Pull xmlns=\"http://schemas.xmlsoap.org/ws/2004/09/enumeration\"><EnumerationContext>" + enumctx + "</EnumerationContext><MaxElements>999</MaxElements><MaxCharacters>99999</MaxCharacters></Pull></Body></Envelope>", callback, tag, pri);
    }

    // Private method
    obj.ParseWsman = function (xml) {
        try {
            if (!xml.childNodes) xml = _turnToXml(xml);
            var r = { Header:{} }, header = xml.getElementsByTagName("Header")[0], t;
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
            console.log("Unable to parse XML: " + xml);
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
				for(var j = 0; j < child.attributes.length; j++) {
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
					for (var i=0; i< selectorArray.length; i++) {
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

	/* 
	convert 
		{ @Name: 'InstanceID', @AttrName: 'Attribute Value'}
	into
		' Name="InstanceID" AttrName="Attribute Value" '
	*/
    function _ObjectToXmlAttributes(objWithAttributes) {
		if(!objWithAttributes) return '';
		var result = ' ';
		for (var propName in objWithAttributes) {
			if (!objWithAttributes.hasOwnProperty(propName) || propName.indexOf('@') !== 0) continue;
			result += propName.substring(1) + '="' + objWithAttributes[propName] + '" ';
		}
		return result;
	}

    function _PutObjToSelectorsXml(selectorSet) {
        if (!selectorSet) return '';
        if (typeof selectorSet == 'string') return selectorSet;
        if (selectorSet['InstanceID']) return "<w:SelectorSet><w:Selector Name=\"InstanceID\">" + selectorSet['InstanceID'] + "</w:Selector></w:SelectorSet>";
		var result = '<w:SelectorSet>';
		for(var propName in selectorSet) {
		    if (!selectorSet.hasOwnProperty(propName)) continue;
		    result += '<w:Selector Name="' + propName + '">';
		    if (selectorSet[propName]['ReferenceParameters']) {
		        result += '<a:EndpointReference>';
		        result += '<a:Address>' + selectorSet[propName]['Address'] + '</a:Address><a:ReferenceParameters><w:ResourceURI>' + selectorSet[propName]['ReferenceParameters']['ResourceURI'] + '</w:ResourceURI><w:SelectorSet>';
		        var selectorArray = selectorSet[propName]['ReferenceParameters']['SelectorSet']['Selector'];
		        if (Array.isArray(selectorArray)) {
		            for (var i = 0; i < selectorArray.length; i++) {
		                result += '<w:Selector' + _ObjectToXmlAttributes(selectorArray[i]) + '>' + selectorArray[i]['Value'] + '</w:Selector>';
		            }
		        }
		        else {
		            result += '<w:Selector' + _ObjectToXmlAttributes(selectorArray) + '>' + selectorArray['Value'] + '</w:Selector>';
		        }
		        result += '</w:SelectorSet></a:ReferenceParameters></a:EndpointReference>';
		    } else {
		        result += selectorSet[propName];
		    }
			result += '</w:Selector>';
		}
		result += '</w:SelectorSet>';
		return result;
	}

    // This is a drop-in replacement to _turnToXml() that works without xml parser dependency.
    Object.defineProperty(Array.prototype, "peek", { value: function () { return (this.length > 0 ? this[this.length - 1] : null); } });
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
}

module.exports = WsmanStackCreateService;
