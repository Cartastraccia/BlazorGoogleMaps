﻿function stringToFunction(str) {
    let arr = str.split(".");

    let fn = window || this;
    for (let i = 0, len = arr.length; i < len; i++) {
        fn = fn[arr[i]];
    }

    if (typeof fn !== "function") {
        throw new Error("function not found");
    }

    return fn;
}

const dateFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function dateObjectReviver(key, value) {
    if (typeof value === "string" && dateFormat.test(value)) {
        return new Date(value);
    }
    return value;
}

function tryParseJson(item) {
    //console.log(item);

    if (item !== null
        && typeof item === "object"
        && "invokeMethodAsync" in item) {
        //console.log("wrap dotnet object ref");

        return async function (...args) {
            if (args === null || typeof args === "undefined")
                await item.invokeMethodAsync("Invoke");

            //console.log(args);

            //let args2 = args.map(arg => {
            //    if (typeof arg === "object" && "toJson" in arg) {
            //        console.log("toJson");
            //        return arg.toJson();
            //    } else {
            //        return arg;
            //    }
            //});

            //console.log(args);

            var guid = googleMapsObjectManager.addObject(args[0]);

            await item.invokeMethodAsync("Invoke", JSON.stringify(args), guid);

            googleMapsObjectManager.disposeObject(guid);
        };
    }

    if (typeof item !== "string")
        return item;

    let item2 = null;

    try {
        item2 = JSON.parse(item, dateObjectReviver);
    } catch (e) {
        return item.replace(/['"]+/g, '');
    }

    if (typeof item2 === "object" && item2 !== null) {
        if ("guidString" in item2) {
            //console.log("Found object has Guid property.");
            return window._blazorGoogleMapsObjects[item2.guidString];
        } else {
            for (var propertyName in item2) {
                let propertyValue = item2[propertyName];
                if (typeof propertyValue === "object"
                    && propertyValue !== null
                    && "guidString" in propertyValue) {
                    //console.log("Found object has Guid property.");
                    item2[propertyName] = window._blazorGoogleMapsObjects[propertyValue.guidString];
                }
            }

            return item2;
        }
    }

    return item.replace(/['"]+/g, '');
}

function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

//Strips the DirectionResult from some of the heaviest collections.
//ServerSide (Client Side have no issues) reach MaximumReceiveMessageSize (32kb) and crash if we return all data
//Workaround is to increase limit MaximumReceiveMessageSize
function cleanDirectionResult(dirResponse, dirRequestOptions) {
    let tmpdirobj = JSON.parse(JSON.stringify(dirResponse));

    tmpdirobj.routes.forEach((r) => {
        if (dirRequestOptions == undefined || dirRequestOptions.stripOverviewPath) {
            r.overview_path = [];
        }

        if (dirRequestOptions == undefined || dirRequestOptions.stripOverviewPolyline) {
            r.overview_polyline = '';//Previously was []. Why??? it is a string
        }

        r.legs.forEach((l) => {
            if (dirRequestOptions == undefined || dirRequestOptions.stripLegsSteps) {
                l.steps = [];
            } else {
                l.steps.forEach((step) => {
                    if (dirRequestOptions == undefined || dirRequestOptions.stripLegsStepsLatLngs) {
                        step.lat_lngs = [];
                    }

                    if (dirRequestOptions == undefined || dirRequestOptions.stripLegsStepsPath) {
                        step.path = [];
                    }
                });
            }
        });
    });

    return tmpdirobj;
}

window.googleMapsObjectManager = {
    createObject: function (args) {
        window._blazorGoogleMapsObjects = window._blazorGoogleMapsObjects || [];

        let args2 = args.slice(2).map(arg => tryParseJson(arg));
        //console.log(args2);
        let functionName = args[1];
        let constructor = stringToFunction(functionName);
        let obj = new constructor(...args2);
        let guid = args[0];

        if ("set" in obj) {
            obj.set("guidString", guid);
        }

        window._blazorGoogleMapsObjects[guid] = obj;
    },

    addObject: function (obj, guid) {
        if (guid === null || typeof guid === "undefined") {
            guid = uuidv4();
        }

        window._blazorGoogleMapsObjects = window._blazorGoogleMapsObjects || [];
        window._blazorGoogleMapsObjects[guid] = obj;

        return guid;
    },

    disposeMapElements(mapGuid) {
        var keysToRemove = [];

        for (var key in _blazorGoogleMapsObjects) {
            if (_blazorGoogleMapsObjects.hasOwnProperty(key)) {
                var element = _blazorGoogleMapsObjects[key];
                if (element.hasOwnProperty("map")
                    && element.hasOwnProperty("guidString")
                    && element.map.guidString === mapGuid) {
                    keysToRemove.push(element.guidString);
                }
            }
        }

        for (var keyToRemove in keysToRemove) {
            if (keysToRemove.hasOwnProperty(keyToRemove)) {
                var elementToRemove = keysToRemove[keyToRemove];
                delete window._blazorGoogleMapsObjects[elementToRemove];
            }
        }
    },

    disposeObject: function (guid) {
        delete window._blazorGoogleMapsObjects[guid];
    },

    invoke: async function (args) {
        let args2 = args.slice(2).map(arg => tryParseJson(arg));

        let obj = window._blazorGoogleMapsObjects[args[0]];


        //If function is route, then handle callback in promise.
        if (args[1] == "googleMapDirectionServiceFunctions.route") {
            let dirRequest = args2[0];
            let dirRequestOptions = args2[1];

            let promise = new Promise((resolve, reject) => {
                let directionsService = new google.maps.DirectionsService();
                directionsService.route(dirRequest, (result, status) => {
                    if (status == 'OK') {
                        resolve(result);
                    }
                    else {
                        reject(status);
                    }
                });
            });

            //Wait for promise
            try {
                let result = await promise;
                obj.setDirections(result);

                let jsonRest = JSON.stringify(cleanDirectionResult(result, dirRequestOptions));
                //console.log(JSON.stringify(jsonRest));
                return jsonRest;
            } catch (error) {
                console.log(error);
                return error;
            }

        }
        else
            if (args[1] == "getDirections") {
                let dirRequestOptions = args2[0];

                try {
                    var result = obj[args[1]]();
                } catch (e) {
                    console.log(e);
                }

                let jsonRest = JSON.stringify(cleanDirectionResult(result, dirRequestOptions));
                return jsonRest;
            }
            else {
                var result = null;
                try {
                    result = obj[args[1]](...args2);
                } catch (e) {
                    console.log(e);
                }

                if (result !== null
                    && typeof result === "object") {
                    if (result.hasOwnProperty("geocoded_waypoints") && result.hasOwnProperty("routes")) {

                        let jsonRest = JSON.stringify(cleanDirectionResult(result));
                        return jsonRest;
                    }
                    if ("getArray" in result) {
                        return result.getArray();
                    }
                    if ("get" in result) {
                        return result.get("guidString");
                    } else if ("dotnetTypeName" in result) {
                        return JSON.stringify(result);
                    } else {
                        return result;
                    }
                } else {
                    return result;
                }
            }
    },

    invokeWithReturnedObjectRef: function (args) {
        let result = googleMapsObjectManager.invoke(args);
        let uuid = uuidv4();


        //console.log("invokeWithReturnedObjectRef " + uuid);

        //Removed since here exists only events and whats point of having event in this array????
        //window._blazorGoogleMapsObjects[uuid] = result;

        return uuid;
    },

    readObjectPropertyValue: function (args) {
        let obj = window._blazorGoogleMapsObjects[args[0]];

        return obj[args[1]];
    },

    readObjectPropertyValueWithReturnedObjectRef: function (args) {

        let obj = window._blazorGoogleMapsObjects[args[0]];

        let result = obj[args[1]];
        let uuid = uuidv4();

        window._blazorGoogleMapsObjects[uuid] = result;

        return uuid;
    }
};
