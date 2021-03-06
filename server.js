"use strict";

//  OpenShift sample Node application
const express = require('express'),
    fs      = require('fs'),
    app     = express(),
    eps     = require('ejs'),
    morgan  = require('morgan'),
    https = require('https'),
    fetch   = require('node-fetch');

const ENV = {
    PROD: process.env.PORTAL_PROD_HOST,
    STAGE: process.env.PORTAL_STAGE_HOST,
    QA: process.env.PORTAL_QA_HOST,
    DEV: process.env.PORTAL_DEV_HOST,
};

const apps = require('./apps.json');

const results = {
    PROD: {},
    STAGE: {},
    QA: {},
    DEV: {},
};

Object.assign=require('object-assign')

app.engine('html', require('ejs').renderFile);
app.use(morgan('combined'));

var port = process.env.PORT || process.env.OPENSHIFT_NODEJS_PORT || 8080,
    ip   = process.env.IP   || process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0';

app.get('/', function (req, res) {
    res.send(JSON.stringify(results, null, 4));
});

// error handling
app.use(function(err, req, res, next){
    console.error(err.stack);
    res.status(500).send('Something bad happened!');
});

app.listen(port, ip);
console.log('Server running on http://%s:%s', ip, port);
console.log('Environment configuration:', JSON.stringify(ENV, null, 4));

function getResponseText(res) {
    return res.text();
}

function getBuildDate(text) {
    const dateText = /builddate.*"(.*)"/.exec(text) || {};
    return new Date(dateText[1]);
}
function networkErrorHandler() {
    console.log('Networking error: ', arguments);
}

function fetchBuildDates(app, path, env) {
    const agentOptions = {
        rejectUnauthorized: false,
    };

    console.log(`GET [${env}:${app.name}] ${path}`);

    // fetch a page from the app and extract the build date from its chrome
    const fetchAppChrome = fetch(
        ENV[env] + path,
        { agent: new https.Agent(agentOptions) }
    ).then(getResponseText)
        .then(getBuildDate)
        .catch(networkErrorHandler);

    // fetch the chrome directly from the chrome service and get build date
    const fetchChrome = fetch(
        ENV[env] + '/services/chrome/head',
        { agent: new https.Agent(agentOptions) }
    ).then(getResponseText)
        .then(getBuildDate)
        .catch(networkErrorHandler);

    return Promise.all([fetchAppChrome, fetchChrome]);
}

function compareBuildDates(app, path, env) {
    return dates => {
        const hour = 1000 * 60 * 60;
        const appChromeDate = dates[0].getTime();
        const chromeDate    = dates[1].getTime();
        const nowDate       = new Date().getTime();
        const hoursSinceLastBuild = (nowDate - chromeDate) / hour;
        let hoursApart    = (chromeDate - appChromeDate) / hour;

        // if the most recent cpchrome build just happened, we shouldn't
        // penalize apps for not having fetched it yet.  give apps a ~couple
        // hours of courtesy time.
        if (hoursSinceLastBuild < 2) {
            hoursApart = 'AWAITING_FRESH_CHROME';
        }
        results[env][app.name] = results[env][app.name] || {};
        results[env][app.name][path] = hoursApart;

        console.log(`${hoursSinceLastBuild} hours since last cp-chrome build`);

        // console.log(JSON.stringify(results, null, 4));
        console.log(`200 [${env}:${app.name}] ${path} is ${hoursApart.toFixed(1)} hours old`);
    };
}

// for each environment
function checkAllApps() {
    Object.keys(ENV).forEach(env => {
        if (ENV[env]) {
            // for each application
            apps.forEach(app => {
                // for each path owned by that application
                app.paths.forEach(path => {
                    // check & update chrome build dates
                    fetchBuildDates(app, path, env)
                        .then(compareBuildDates(app, path, env));
                });
            });
        }
    });
}


checkAllApps();
setInterval(checkAllApps, 15*60*1000);

module.exports = app ;
