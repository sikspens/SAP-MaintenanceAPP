"use strict";

sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    /**
     * Process each measure according to the defined calculation
     * @param {Object} oGroupedDataLine the content of the "grouped" line of data
     * @param {Object} mMeasureCalculation the calculation definition
     * @param {Object} oSeenValues an object containing a map of the value seen so far
     * @returns {Function} a function for the iterator
     */
    function prepareMeasureValues(oGroupedDataLine, mMeasureCalculation, oSeenValues) {
        return function (oMeasureValues) {
            for (var sMeasureName in mMeasureCalculation) {
                if (mMeasureCalculation.hasOwnProperty(sMeasureName)) {
                    var sSourceMeasureName = mMeasureCalculation[sMeasureName].source;
                    var oMeasureValue = oMeasureValues[sSourceMeasureName];
                    if (oGroupedDataLine[sMeasureName] === undefined) {
                        switch (mMeasureCalculation[sMeasureName].operation) {
                            case "COUNT":
                                oGroupedDataLine[sMeasureName] = 1;
                                break;
                            case "DISTINCTCOUNT":
                                oGroupedDataLine[sMeasureName] = 0;
                                oSeenValues[sMeasureName][oMeasureValue] = true;
                                break;
                            case "SUM":
                            case "AVG":
                            case "MIN":
                            case "MAX":
                            default:
                                oGroupedDataLine[sMeasureName] = parseFloat(oMeasureValue);
                                break;
                        }
                    }
                    else {
                        switch (mMeasureCalculation[sMeasureName].operation) {
                            case "SUM":
                            case "AVG":
                                oGroupedDataLine[sMeasureName] += parseFloat(oMeasureValue);
                                break;
                            case "MIN":
                                oGroupedDataLine[sMeasureName] = Math.min(oMeasureValue, oGroupedDataLine[sMeasureName]);
                                break;
                            case "MAX":
                                oGroupedDataLine[sMeasureName] = Math.max(oMeasureValue, oGroupedDataLine[sMeasureName]);
                                break;
                            case "COUNT":
                                oGroupedDataLine[sMeasureName] += 1;
                                break;
                            case "DISTINCTCOUNT":
                                oSeenValues[sMeasureName][oMeasureValue] = true;
                                break;
                            default:
                                oGroupedDataLine[sMeasureName] = parseFloat(oMeasureValue);
                                break;
                        }
                    }
                }
            }
        };
    }

    /**
     * Retrieve the data from the model, the path can contains '/'
     * @param {Object} oData the model data
     * @param {string} sPath the path to look for
     * @returns {any} the value found for that path
     */
    function getModelData(oData, sPath) {
        if (!oData) {
            return undefined;
        }
        var aPath = sPath.split("/");
        if (aPath.length > 1) {
            var oSubData = oData[aPath[0]];
            return getModelData(oSubData, aPath.slice(1).join("/"));
        }
        else {
            return oData[aPath[0]];
        }
    }

    /**
     * Create a function that will process the read request and create the JSONModel to return to the chart
     * @param {string[]} aDimensionNames an array of the dimension names
     * @param {string[]} aMeasureNames an array of the measure names
     * @param {Object} mMeasureCalculation a map containing information about the measure calculation
     * @param {Function} fnCallback function to call with the created JSONModel
     * @returns {Function} the 'success' request handler
     */
    function processReadRequest(aDimensionNames, aMeasureNames, mMeasureCalculation, fnCallback) {
        return function (oData) {
            var oGroupedData = {};
            oData.results.forEach(function (resultLine) {
                var sKey = "";
                aDimensionNames.forEach(function (sDimensionName) {
                    if (sKey.length > 0) {
                        sKey += "/";
                    }
                    sKey += sDimensionName + ":" + getModelData(resultLine, sDimensionName);
                });
                if (!oGroupedData[sKey]) {
                    oGroupedData[sKey] = Object.assign({}, resultLine);
                    oGroupedData[sKey].measureValues = [];
                }
                var oMeasureValues = {};
                aMeasureNames.forEach(function (sMeasureName) {
                    oMeasureValues[sMeasureName] = getModelData(resultLine, sMeasureName);
                });
                oGroupedData[sKey].measureValues.push(oMeasureValues);
            });

            var aData = [];
            for (var sKey in oGroupedData) {
                if (oGroupedData.hasOwnProperty(sKey)) {
                    var oGroupedDataLine = oGroupedData[sKey];
                    var oSeenValues = {};
                    for (var sMeasureName in mMeasureCalculation) {
                        oSeenValues[sMeasureName] = {};
                    }
                    oGroupedDataLine.measureValues.forEach(prepareMeasureValues(oGroupedDataLine, mMeasureCalculation, oSeenValues));

                    for (var sMeasureName in mMeasureCalculation) {
                        if (mMeasureCalculation[sMeasureName].operation === "DISTINCTCOUNT") {
                            oGroupedDataLine[sMeasureName] = Object.keys(oSeenValues[sMeasureName]).length;
                        }
                        else if (mMeasureCalculation[sMeasureName].operation === "AVG") {
                            oGroupedDataLine[sMeasureName] = oGroupedDataLine[sMeasureName] / oGroupedDataLine.measureValues.length;
                        }
                    }
                    delete oGroupedDataLine.measures;
                    aData.push(oGroupedDataLine);
                }
            }
            var oModel = new JSONModel();
            oModel.setData(aData);

            fnCallback(oModel);
        };
    }

    return {
        /**
         * Request a JSONModel that will contained the calculated data for the KPI
         * @param {string} sName the chart identifier
         * @param {Object} oChart the chart control
         * @param {Object} oModel the ODataModel to query
         * @param {string} sEntityName the entity name on which this all applies
         * @param {Object[]} aDimensions an array containing the dimensions from the chart
         * @param {Object} mMeasureCalculation a map containing information about the measure calculation
         * @param {Object} fnSortAndFilter a function to retrieve the sort and filters to apply
         * @param {Function} fnCallback function to call with the created JSONModel
         */
        getKPIModel: function (sName, oChart, oModel, sEntityName, aDimensions, mMeasureCalculation, fnSortAndFilter, fnCallback) {
            var aDimensionNames = aDimensions.map(function (oDimension) {
                return oDimension.getName();
            });
            var aMeasureNames = [];
            for (var sCalculatedMeasureName in mMeasureCalculation) {
                if (aMeasureNames.indexOf(mMeasureCalculation[sCalculatedMeasureName].source) === -1) {
                    aMeasureNames.push(mMeasureCalculation[sCalculatedMeasureName].source);
                }
            }
            var aSelectParameter = aDimensionNames.concat(aMeasureNames);
            oChart.bindElement({
                path: sEntityName,
                events: {
                    change: performRead.bind(this),
dataReceived: performRead.bind(this)
                }
            });

            function performRead(event) {
                var oSortAndFilters = fnSortAndFilter(sName) || {};
                var mQueryParams = {
                    context: event.getSource().getContext(),
                    urlParameters: {
                        $select: aSelectParameter
                    },
                    sorters: oSortAndFilters.sorters,
                    filters: oSortAndFilters.filters,
                    success: processReadRequest(aDimensionNames, aMeasureNames, mMeasureCalculation, fnCallback),
                    error: function (oError) {
                        throw new Error("Error while loading the data in order to create the KPI Model", oError);
                    }
                };
                oModel.read(sEntityName, mQueryParams);
            }
        }
    };
}, true);