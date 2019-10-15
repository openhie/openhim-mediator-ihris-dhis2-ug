#!/usr/bin/env node
'use strict'

const express = require('express')
const medUtils = require('openhim-mediator-utils')
const winston = require('winston')
const request = require('request')
const isJSON = require('is-json')
const URI = require('urijs')
const async = require('async')
const utils = require('./utils')
const iHRIS = require('./ihris')
const DHIS2 = require('./dhis')

const https = require('https')
const http = require('http')

https.globalAgent.maxSockets = 32
http.globalAgent.maxSockets = 32
// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {level: 'info', timestamp: true, colorize: true})

// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = process.env.NODE_ENV === 'test' ? require('../config/test') : require('../config/config')
const mediatorConfig = require('../config/mediator')

var port = process.env.NODE_ENV === 'test' ? 7001 : mediatorConfig.endpoints[0].port


/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp () {
  const app = express()

  function updateTransaction(req, body, statatusText, statusCode, orchestrations) {
    const transactionId = req.headers['x-openhim-transactionid']
    var update = {
      'x-mediator-urn': mediatorConfig.urn,
      status: statatusText,
      response: {
        status: statusCode,
        timestamp: new Date(),
        body: body
      },
      orchestrations: orchestrations
    }
    medUtils.authenticate(apiConf.api, function (err) {
      if (err) {
        return winston.error(err.stack);
      }
      var headers = medUtils.genAuthHeaders(apiConf.api)
      var options = {
        url: apiConf.api.apiURL + '/transactions/' + transactionId,
        headers: headers,
        json: update
      }

      request.put(options, function (err, apiRes, body) {
        if (err) {
          return winston.error(err);
        }
        if (apiRes.statusCode !== 200) {
          return winston.error(new Error('Unable to save updated transaction to OpenHIM-core, received status code ' + apiRes.statusCode + ' with body ' + body).stack);
        }
        winston.info('Successfully updated transaction with id ' + transactionId);
      });
    })
  }

  app.get('/iHRISData',(req, res) => {
    let orchestrations = []
    const ihris = iHRIS(config.ihris)
    const dhis = DHIS2(config.dhis2)
    var ihrisusername = config.ihris.username
    var ihrispassword = config.ihris.password
    res.end()
    updateTransaction(req, "Still Processing", "Processing", "200", "")

    ihris.getDistricts(orchestrations,(districts) => {
      async.each(districts, (district, nxtDistrict) => {
        winston.info("Processing " + district)
        var ihrisurl = new URI(config.ihris.url).segment('/dhis/_history').addQuery('_format' , 'json' ).addSearch('_district', district)
        var ihrisauth = "Basic " + new Buffer(ihrisusername + ":" + ihrispassword).toString("base64")
        var ihrisoptions = {
          url: ihrisurl.toString(),
          headers: {
            Authorization: ihrisauth
          }
        }
        request.get(ihrisoptions, (err, res, body) => {
          if (err) {
            return callback(err)
          }
           dhis.postData(body, orchestrations, (err, res, body) => {
            if (err) {
              var getResponse = JSON.stringify(JSON.parse(res))
              winston.info('Failed to post Data for ' + district + ' ' + getResponse)
              return callback(err)
            } else {
              winston.info("Processed " + district)
              return nxtDistrict()
            }
          })

        })
        
        
      }, function () {
        winston.info("Done Moving Aggregate data to DHIS2")
        updateTransaction(req, "", "Successful", "200", orchestrations)
        orchestrations = []
      })
    })

  })

  return app
}



/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start (callback) {
  if (apiConf.api.trustSelfSigned) { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' }

  if (apiConf.register) {
    medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        winston.error('Failed to register this mediator, check your config')
        winston.error(err.stack)
        process.exit(1)
      }
      apiConf.api.urn = mediatorConfig.urn
      medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
        winston.info('Received initial config:')
        winston.info(JSON.stringify(newConfig))
        config = newConfig
        if (err) {
          winston.error('Failed to fetch initial config')
          winston.error(err.stack)
          process.exit(1)
        } else {
          winston.info('Successfully registered mediator!')
          let app = setupApp()
          const server = app.listen(port, () => {
            if (apiConf.heartbeat) {
              let configEmitter = medUtils.activateHeartbeat(apiConf.api)
              configEmitter.on('config', (newConfig) => {
                winston.info('Received updated config:')
                winston.info(JSON.stringify(newConfig))
                // set new config for mediator
                config = newConfig

                // we can act on the new config received from the OpenHIM here
                winston.info(config)
              })
            }
            callback(server)
          })
        }
      })
    })
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config
    let app = setupApp()
    const server = app.listen(port, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info(`Listening on ${port}...`))
}
