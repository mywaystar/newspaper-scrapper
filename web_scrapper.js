var redis = require("redis");
var pub = redis.createClient();
var sub = redis.createClient();
var scraperjs = require('scraperjs');
var RedisLockingWorker = require("redis-locking-worker");
var MongoClient = require('mongodb').MongoClient;


// Connection URL
var db;
var url = 'mongodb://localhost:27017/media';
MongoClient.connect(url, function (err, _db) {
    db = _db;
});
var medias = require('./config.js').medias;


sub.subscribe("article:publish");

sub.on("message", function (channel, json) {
    json = JSON.parse(json);
    processEvent(json);
});

function processEvent(data) {

    var worker = new RedisLockingWorker({
        'client': pub,
        'lockKey': ' lock_' + data.link,
        'statusLevel': RedisLockingWorker.StatusLevels.Verbose,
        'lockTimeout': 5000,
        'maxAttempts': 5
    });
    worker.on("acquired", function (lastAttempt) {
        //console.log("[redis-client] Acquired lock %s", worker.lockKey);
        scrapUrl(data.media, data.link, data.tags);
        //console.info("[redis-client] Work complete. Deleting lock %s", worker.lockKey);
        worker.done(true);
        worker = undefined;
    });
    worker.on("locked", function () {
        //console.log("[redis-client] Someone else acquired the lock %s", worker.lockKey);
    });
    worker.on("error", function (error) {
        //console.log("[redis-client] Error from lock %s: %j", worker.lockKey, error);
    });
    worker.on("status", function (message) {
        //console.log("[redis-client] Status message from lock %s: %s", worker.lockKey, message);
    });
    worker.acquire();
}

var scrapUrl = function (media, link, tags) {
    if (medias[media] === undefined) return;

    scraperjs.StaticScraper.create(link)
        .scrape(medias[media].scraper, function (data) {
            if (data === null || data === undefined || data.title.length < 10) return;

            var article = {};
            article.media = media;
            article.link = link;
            article.tags = tags;
            article.title = data.title;
            article.content = data.content;
            article.img = data.img;
            article.time = new Date().getTime();
            var collection = db.collection('articles');


            collection.insert(article, function (err, result) {
                console.log("inserted", article.link);

                collection.findOne({link: article.link}, function (err, article) {
                    pub.publish("article:inserted", JSON.stringify(article));
                });

            });

        }).onError(function (err) {
            console.log(err);
        });
};