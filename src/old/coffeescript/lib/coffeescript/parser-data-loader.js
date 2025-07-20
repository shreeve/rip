// Data-loader parser wrapper
var fs = require('fs');
var path = require('path');

// Load parse data from JSON file
function loadParseData(filename) {
  var dataPath = path.resolve(__dirname, filename);
  var rawData = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(rawData);
}

// Default to original data, can be overridden
var parseDataFile = process.env.COFFEESCRIPT_PARSE_DATA || 'parse-data-original.json';
var parseData = loadParseData(parseDataFile);

// Load the working parser
var workingParser = require('./parser-sonar-0.5.2.js');

// Override the embedded data with loaded data
var parser = workingParser.parser;
parser.symbols_ = parseData.symbolMap;
parser.terminals_ = parseData.terminals_;
parser.table = parseData.stateTable;
parser.defaultActions = parseData.defaultActions;

// Export the modified parser
if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
  exports.parser = parser;
  exports.Parser = workingParser.Parser;
  exports.parse = workingParser.parse;
  exports.main = workingParser.main || function() {};
  if (typeof module !== 'undefined' && require.main === module) {
    exports.main(process.argv.slice(1));
  }
}