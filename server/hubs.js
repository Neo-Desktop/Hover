/*!
 * ASP.NET SignalR JavaScript Library v2.0.3
 * http://signalr.net/
 *
 * Copyright Microsoft Open Technologies, Inc. All rights reserved.
 * Licensed under the Apache 2.0
 * https://github.com/SignalR/SignalR/blob/master/LICENSE.md
 *
 */

/// <reference path="..\..\SignalR.Client.JS\Scripts\jquery-1.6.4.js" />
/// <reference path="jquery.signalR.js" />
(function ($, window, undefined) {
    /// <param name="$" type="jQuery" />
    "use strict";

    if (typeof ($.signalR) !== "function") {
        throw new Error("SignalR: SignalR is not loaded. Please ensure jquery.signalR-x.js is referenced before ~/signalr/js.");
    }

    var signalR = $.signalR;

    function makeProxyCallback(hub, callback) {
        return function () {
            // Call the client hub method
            callback.apply(hub, $.makeArray(arguments));
        };
    }

    function registerHubProxies(instance, shouldSubscribe) {
        var key, hub, memberKey, memberValue, subscriptionMethod;

        for (key in instance) {
            if (instance.hasOwnProperty(key)) {
                hub = instance[key];

                if (!(hub.hubName)) {
                    // Not a client hub
                    continue;
                }

                if (shouldSubscribe) {
                    // We want to subscribe to the hub events
                    subscriptionMethod = hub.on;
                } else {
                    // We want to unsubscribe from the hub events
                    subscriptionMethod = hub.off;
                }

                // Loop through all members on the hub and find client hub functions to subscribe/unsubscribe
                for (memberKey in hub.client) {
                    if (hub.client.hasOwnProperty(memberKey)) {
                        memberValue = hub.client[memberKey];

                        if (!$.isFunction(memberValue)) {
                            // Not a client hub function
                            continue;
                        }

                        subscriptionMethod.call(hub, memberKey, makeProxyCallback(hub, memberValue));
                    }
                }
            }
        }
    }

    $.hubConnection.prototype.createHubProxies = function () {
        var proxies = {};
        this.starting(function () {
            // Register the hub proxies as subscribed
            // (instance, shouldSubscribe)
            registerHubProxies(proxies, true);

            this._registerSubscribedHubs();
        }).disconnected(function () {
            // Unsubscribe all hub proxies when we "disconnect".  This is to ensure that we do not re-add functional call backs.
            // (instance, shouldSubscribe)
            registerHubProxies(proxies, false);
        });

        proxies.hoverHub = this.createHubProxy('hoverHub'); 
        proxies.hoverHub.client = { };
        proxies.hoverHub.server = {
            capturedFlag: function (flagPos) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["CapturedFlag"], $.makeArray(arguments)));
             },

            createGame: function (mazeId, numFlags, numPlayers) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["CreateGame"], $.makeArray(arguments)));
             },

            createTempWall: function (wall) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["CreateTempWall"], $.makeArray(arguments)));
             },

            fireBullet: function (b) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["FireBullet"], $.makeArray(arguments)));
             },

            hitPod: function (pos) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["HitPod"], $.makeArray(arguments)));
             },

            join: function (gameId, craftProfile, playerName) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["Join"], $.makeArray(arguments)));
             },

            sendBulletDestroyed: function (bulletId) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["SendBulletDestroyed"], $.makeArray(arguments)));
             },

            sendCollision: function (c) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["SendCollision"], $.makeArray(arguments)));
             },

            sendMyBulletHitCraft: function (bulletId, connId) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["SendMyBulletHitCraft"], $.makeArray(arguments)));
             },

            setCraftState: function (craft) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["SetCraftState"], $.makeArray(arguments)));
             },

            spawnMe: function () {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["SpawnMe"], $.makeArray(arguments)));
             },

            uncapturedFlag: function (flagPos) {
                return proxies.hoverHub.invoke.apply(proxies.hoverHub, $.merge(["UncapturedFlag"], $.makeArray(arguments)));
             }
        };

        return proxies;
    };

    signalR.hub = $.hubConnection("/signalr", { useDefaultPath: false });
    $.extend(signalR, signalR.hub.createHubProxies());

}(window.jQuery, window));