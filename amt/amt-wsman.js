/*
Copyright 2020-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

@description Intel AMT WSMAN Stack
@author Ylian Saint-Hilaire
@version v0.3.0
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a WSMAN stack object
function WsmanStackCreateService(comm)
{
    var obj = {_ObjectID: 'WSMAN'};
    //obj.onDebugMessage = null;          // Set to a function if you want to get debug messages.
    obj.NextMessageId = 1;              // Next message number, used to label WSMAN calls.
    obj.Address = '/wsman';
    obj.xmlParser = require('./amt-xml.js');
    obj.comm = comm;

    obj.PerformAjax = function PerformAjax(postdata, callback, tag, pri, namespaces) {
        if (namespaces == null) namespaces = '';
        obj.comm.PerformAjax('<?xml version=\"1.0\" encoding=\"utf-8\"?><Envelope xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:w="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns=\"http://www.w3.org/2003/05/soap-envelope\" ' + namespaces + '><Header><a:Action>' + postdata, function (data, status, tag) {
            var wsresponse = null;
            if (data != null) { try { wsresponse = obj.xmlParser.ParseWsman(data); } catch (ex) { } }
            if ((data != null) && (!wsresponse || wsresponse == null) && (status == 200)) {
                callback(obj, null, { Header: { HttpError: status } }, 601, tag);
            } else {
                if (status != 200) {
                    if (wsresponse == null) { wsresponse = { Header: {} }; }
                    wsresponse.Header.HttpError = status;
                    try { wsresponse.Header.WsmanError = wsresponse.Body['Reason']['Text']['Value']; } catch (ex) { }
                }
                callback(obj, wsresponse.Header['ResourceURI'], wsresponse, status, tag);
            }
        }, tag, pri);
    }

    // Private method
    //obj.Debug = function (msg) { /*console.log(msg);*/ }

    // Cancel all pending queries with given status
    obj.CancelAllQueries = function CancelAllQueries(s) { obj.comm.CancelAllQueries(s); }

    // Get the last element of a URI string
    obj.GetNameFromUrl = function (resuri) {
        var x = resuri.lastIndexOf("/");
        return (x == -1)?resuri:resuri.substring(x + 1);
    }

    // Perform a WSMAN Subscribe operation
    obj.ExecSubscribe = function ExecSubscribe(resuri, delivery, url, callback, tag, pri, selectors, opaque, user, pass) {
        var digest = "", digest2 = "", opaque = "";
        if (user != null && pass != null) { digest = '<t:IssuedTokens xmlns:t="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:se="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><t:RequestSecurityTokenResponse><t:TokenType>http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#UsernameToken</t:TokenType><t:RequestedSecurityToken><se:UsernameToken><se:Username>' + user + '</se:Username><se:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#PasswordText">' + pass + '</se:Password></se:UsernameToken></t:RequestedSecurityToken></t:RequestSecurityTokenResponse></t:IssuedTokens>'; digest2 = '<w:Auth Profile="http://schemas.dmtf.org/wbem/wsman/1/wsman/secprofile/http/digest"/>'; }
        if (opaque != null) { opaque = '<a:ReferenceParameters><m:arg>' + opaque + '</m:arg></a:ReferenceParameters>'; }
        if (delivery == 'PushWithAck') { delivery = 'dmtf.org/wbem/wsman/1/wsman/PushWithAck'; } else if (delivery == 'Push') { delivery = 'xmlsoap.org/ws/2004/08/eventing/DeliveryModes/Push'; }
        var data = "http://schemas.xmlsoap.org/ws/2004/08/eventing/Subscribe</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>" + _PutObjToSelectorsXml(selectors) + digest + '</Header><Body><e:Subscribe><e:Delivery Mode="http://schemas.' + delivery + '"><e:NotifyTo><a:Address>' + url + '</a:Address>' + opaque + '</e:NotifyTo>' + digest2 + '</e:Delivery></e:Subscribe>';
        obj.PerformAjax(data + "</Body></Envelope>", callback, tag, pri, 'xmlns:e="http://schemas.xmlsoap.org/ws/2004/08/eventing" xmlns:m="http://x.com"');
    }

    // Perform a WSMAN UnSubscribe operation
    obj.ExecUnSubscribe = function ExecUnSubscribe(resuri, callback, tag, pri, selectors) {
        var data = "http://schemas.xmlsoap.org/ws/2004/08/eventing/Unsubscribe</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>" + _PutObjToSelectorsXml(selectors) + '</Header><Body><e:Unsubscribe/>';
        obj.PerformAjax(data + "</Body></Envelope>", callback, tag, pri, 'xmlns:e="http://schemas.xmlsoap.org/ws/2004/08/eventing"');
    }

    // Perform a WSMAN PUT operation
    obj.ExecPut = function ExecPut(resuri, putobj, callback, tag, pri, selectors) {
        var data = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Put</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60.000S</w:OperationTimeout>" + _PutObjToSelectorsXml(selectors) + '</Header><Body>' + _PutObjToBodyXml(resuri, putobj);
        obj.PerformAjax(data + "</Body></Envelope>", callback, tag, pri);
    }
		
    // Perform a WSMAN CREATE operation
    obj.ExecCreate = function ExecCreate(resuri, putobj, callback, tag, pri, selectors) {
        var objname = obj.GetNameFromUrl(resuri);
        var data = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout>" + _PutObjToSelectorsXml(selectors) + "</Header><Body><g:" + objname + " xmlns:g=\"" + resuri + "\">";
        for (var n in putobj) { data += "<g:" + n + ">" + putobj[n] + "</g:" + n + ">" } 
        obj.PerformAjax(data + "</g:" + objname + "></Body></Envelope>", callback, tag, pri);
    }

    // Perform a WSMAN DELETE operation
    obj.ExecDelete = function ExecDelete(resuri, putobj, callback, tag, pri) {
        var data = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout>" + _PutObjToSelectorsXml(putobj) + "</Header><Body /></Envelope>";
        obj.PerformAjax(data, callback, tag, pri);
    }

    // Perform a WSMAN GET operation
    obj.ExecGet = function ExecGet(resuri, callback, tag, pri) {
        obj.PerformAjax("http://schemas.xmlsoap.org/ws/2004/09/transfer/Get</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout></Header><Body /></Envelope>", callback, tag, pri);
    }

	// Perform a WSMAN method call operation
    obj.ExecMethod = function ExecMethod(resuri, method, args, callback, tag, pri, selectors) {
        var argsxml = "";
        for (var i in args) { if (args[i] != null) { if (Array.isArray(args[i])) { for (var x in args[i]) { argsxml += "<r:" + i + ">" + args[i][x] + "</r:" + i + ">"; } } else { argsxml += "<r:" + i + ">" + args[i] + "</r:" + i + ">"; } } }
        obj.ExecMethodXml(resuri, method, argsxml, callback, tag, pri, selectors);
    }
	
    // Perform a WSMAN method call operation. The arguments are already formatted in XML.
    obj.ExecMethodXml = function ExecMethodXml(resuri, method, argsxml, callback, tag, pri, selectors) {
        obj.PerformAjax(resuri + "/" + method + "</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout>" + _PutObjToSelectorsXml(selectors) + "</Header><Body><r:" + method + '_INPUT' + " xmlns:r=\"" + resuri + "\">" + argsxml + "</r:" + method + "_INPUT></Body></Envelope>", callback, tag, pri);
    }

    // Perform a WSMAN ENUM operation
    obj.ExecEnum = function ExecEnum(resuri, callback, tag, pri) {
        obj.PerformAjax("http://schemas.xmlsoap.org/ws/2004/09/enumeration/Enumerate</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout></Header><Body><Enumerate xmlns=\"http://schemas.xmlsoap.org/ws/2004/09/enumeration\" /></Body></Envelope>", callback, tag, pri);
    }

    // Perform a WSMAN PULL operation
    obj.ExecPull = function ExecPull(resuri, enumctx, callback, tag, pri) {
        obj.PerformAjax("http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull</a:Action><a:To>" + obj.Address + "</a:To><w:ResourceURI>" + resuri + "</w:ResourceURI><a:MessageID>" + (obj.NextMessageId++) + "</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo><w:OperationTimeout>PT60S</w:OperationTimeout></Header><Body><Pull xmlns=\"http://schemas.xmlsoap.org/ws/2004/09/enumeration\"><EnumerationContext>" + enumctx + "</EnumerationContext><MaxElements>999</MaxElements><MaxCharacters>99999</MaxCharacters></Pull></Body></Envelope>", callback, tag, pri);
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
		        } else {
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

    return obj;
}

module.exports = WsmanStackCreateService;