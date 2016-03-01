/**
 * @descriptions This script is used for FETC PoC to demonstrate the assembly
 * and serialize capability of IBM API Management. This is to be deployed at
 * DataPower alone, not APIM Custom Policy.
 *
 * @author Johnson YS Chiang (chiangys@tw.ibm.com)
 */

var urlopen = require ('urlopen');
var util = require ('util');
var urlparse = require ('url');
var sm = require ('service-metadata');

// Parse URL
var parsedURL = urlparse.parse (sm.URLIn, true);
var mycase;
if (parsedURL.pathname.indexOf('/smsBalanceByCarno') != -1) {
    mycase = "ByCarno";
} else if (parsedURL.pathname.indexOf('/smsBalanceByEPCID') != -1) {
    mycase = "ByEPCID";
} else {
    throw "Not a correct mycase!";
}


// Include nodejs async module
var async = require ('local:///policy/etag-notification/async.js');

// Used for cross function msging.
var currentOutput;

// Used for debug information
var debugCtx = session.name('debugCtx') || session.createContext('debugCtx');

// Call HTTP URL Open to the \in url and fire the callback when done.
function doURLOpen(url, jsonData, callback, doneMsg) {
    let options = {
        target: url,
        method: 'post',
        contentType: 'application/json',
        timeout: 60,
        data: jsonData
    };

    urlopen.open (options, function (error, response) {
        if (error) {
            // an error occurred during request sending or response header parsing
            callback(new Error("urlopen connect error: " + JSON.stringify(error)));
        } else {
            // read response data and get the response status code
            let responseStatusCode = response.statusCode;
            if (responseStatusCode == 200) {
                response.readAsJSON(function(error, responseData) {
                    if (error) {
                        // error while reading response or transferring data to Buffer
                        callback(new Error("readAsJSON error: " + JSON.stringify(error)));
                    } else {
                        // session.output.write(responseData);
                        currentOutput = responseData;
                        // setOutputContext(responseData);
                        callback(null, doneMsg);
                    } 
                });
            } else {
                callback(new Error("urlopen target return statusCode " + responseStatusCode));
            }
        }
    }); // end of urlopen.open()
}



var esbLocation = "http://10.90.45.66/vasapi/api/ESBPortal";
var stages = {
    "ConsumeInput": "ConsumeInput",
    "CollectCustomerInfo": "CollectCustomerInfo",
    "queryCommonInfo2": "queryCommonInfo2",
    "queryAccountBalance": "query",
    "PutSMSQueue": "PutSMSQueue",
    "Finish": "Finish"
};

var data = {
    "originalInput": null,
    "smsContent": null,
    "epcid": null,
    "lprNumber": null,
    "ownerNumber": null,
    "phoneNumber": null,
    "balance": null,
    "johnsonPhone": "0918365855"
};

function DEBUG_ENTER(stage, msg) {
    console.notice ("[Stage: " + stage + "] entry = " + msg);
}

async.series([
    function(callback) {
        let stage = stages["ConsumeInput"];

        // consume input data

        session.input.readAsJSON(function(error, jsonData) {

            if (error) {
                callback(new Error("Read INPUT as JSON Error: " + JSON.stringify(error)));
            }
            data.originalInput = jsonData;
            DEBUG_ENTER(stage, JSON.stringify(data.originalInput));
            callback(null, "Complete stage " + stage);
        });
    },
    function(callback) {

        // decide which flow to collect the lprNumber and idNo
        data.smsContent = data.originalInput.smsContent;
        let stage = stages["CollectCustomerInfo"];
        DEBUG_ENTER(stage, JSON.stringify(currentOutput));

        let url;
        let postData;
        if (mycase === "ByCarno") {
            url = esbLocation + "/getHistoryOwnerIdByLprNumber";
            data.lprNumber = data.originalInput.lprNumber;

            postData = {
                "apiName": "getHistoryOwnerIdByLprNumber",
                "Body": {
                    "lprNumber" : data.lprNumber
                }
            };

        } else if (mycase === "ByEPCID") {
            url = esbLocation + "/gueryLprNumByEtag";
            data.epcid = data.originalInput.epcId;

            postData = {
                "apiName": "queryLprNumByEtag",
                "Body": {
                    "epcId" : data.epcid
                }
            };
        }

        console.notice("URL Open post data = " + JSON.stringify(postData));
        debugCtx.setVar(stage, postData);

        doURLOpen(url, postData, callback, "Complete URLOpen to " + url);

    },
    function(callback) {
        let stage = stages["queryCommonInfo2"];
        let url = esbLocation + "/queryCommonInfo2";

        DEBUG_ENTER(stage, JSON.stringify(currentOutput));

        if (mycase === "ByCarno") {
            let ownerHistory = currentOutput;
            if (util.safeTypeOf(ownerHistory.Body.idNo) === 'array') {
                for (var i=0; i < ownerHistory.Body.idNo.length; i++) {
                    if (ownerHistory.Body.idNo[i].current == 'Y') {
                        data.ownerNumber = ownerHistory.Body.idNo[0].idNo;
                    }
                }
            }
        } else if (mycase === "ByEPCID") {
            data.lprNumber = currentOutput.Body.lprNumber;
            data.ownerNumber = currentOutput.Body.idNo;
        }

        let postData = {
            "apiName": "queryCommonInfo2",
            "Body": {
                "lprNumber": data.lprNumber,
                "idNo": data.ownerNumber
            }
        }
        console.notice("URL Open post data = " + JSON.stringify(postData));

        debugCtx.setVar(stage, postData);
        doURLOpen(url, postData, callback, "Complete urlopen to " + url);

    },
    function(callback) {
        let stage = stages["queryAccountBalance"];
        let url = esbLocation + "/query";

        DEBUG_ENTER(stage, JSON.stringify(currentOutput));

        let commonInfo = currentOutput;
        data.phoneNumber = commonInfo.Body.vehicle.phone1;

        let postData = {
            "apiName": "query",
            "Body": {
                "idNo": data.ownerNumber,
                "lprNumber": data.lprNumber,
                "shareAccNo": ""
            }
        }
        console.notice("URL Open post data = " + JSON.stringify(postData));

        debugCtx.setVar(stage, postData);
        doURLOpen(url, postData, callback, "Complete urlopen to " + url);

    },
    function(callback) {
        // send SMS with account balance

        let stage = stages["PutSMSQueue"];
        let url = esbLocation + "/PutSMSQueue";

        DEBUG_ENTER(stage, JSON.stringify(currentOutput));

        let balanceInfo = currentOutput;
        data.balance = balanceInfo.Body.account[0].balance;

        data.smsContent = "車主(" + data.lprNumber + ")的ETAG餘額為 " + data.balance + "元";

        let postData = {
            "apiName": "PutSMSQueue",
            "Body": (",1, " + data.lprNumber + ", 34127457," + data.smsContent + "," + data.phoneNumber)
        };

        console.notice("URL Open post data = " + JSON.stringify(postData));
        doURLOpen(url, postData, callback, "Complete URLOpen to " + url);
    },
    function(callback) {
        let stage = stages["Finish"];
        DEBUG_ENTER(stage, JSON.stringify(currentOutput));

        session.output.write (currentOutput);

        callback(null, "Complete ALL");
    }
], function(error, result) {
    console.notice ("async error = " + JSON.stringify(error));
    console.notice ("async result = " + JSON.stringify(result));

});