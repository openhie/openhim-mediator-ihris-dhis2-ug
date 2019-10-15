const winston = require('winston');
const request = require('request')
const utils = require('./utils')
const URI = require('urijs')
const async = require('async')
const isJSON = require('is-json')

module.exports = function (ihrisconfig) {
  const config = ihrisconfig
  return {
    getDistricts: function (orchestrations,callback) {
      var Districts = []
      var url = new URI(config.url).segment('/districts/_history').addQuery('_format', 'json')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }
      let before = new Date()
        request.get(options, function (err, res, body) {
          //winston.error(body)
          if(isJSON(body)) {
            var body = JSON.parse(body)
            if(body.hasOwnProperty("dataValues")) {
              for(let i = 0; i < body.dataValues.length; i++){
                Districts.push(body.dataValues[i].name)
              }
            }
          }
          else {
            winston.error("Non JSON data returned by Districts")
            return callback(err, res, false)
          }
          orchestrations.push(utils.buildOrchestration('Fetching Districts from iHRIS ', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
          return callback(Districts)
        })
    }
  }
}